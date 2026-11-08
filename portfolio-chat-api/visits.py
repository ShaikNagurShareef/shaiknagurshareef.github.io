"""Visit log for the portfolio (audit only).

The site sends one beacon per page view (and one when the page is closed, with time on page).
Each view is enriched server-side with time, approximate location and network owner from the
DB-IP Lite databases (offline lookup, nothing is sent to third parties), then stored as one JSONL
file per UTC day in a private Hugging Face dataset. Only the owner can read it, through
GET /v1/visits with the admin token.

Stored per view: UTC time, page, referrer, a random browser id (localStorage), session id,
browser/OS/device, language, time zone, screen size, city/region/country, network (ASN org),
the IP address with its last block zeroed (IPv4 /24, IPv6 /48), a salted hash of the full IP
(for counting repeat visitors without keeping the address), bot flag, and time on page.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

log = logging.getLogger("portfolio-visits")

DATASET = os.getenv("VISITS_DATASET", "nagur-shareef-shaik/portfolio-visits")
HF_TOKEN = os.getenv("HF_TOKEN")
ADMIN_TOKEN = os.getenv("VISITS_ADMIN_TOKEN", "")
SALT = os.getenv("VISITS_SALT", "")
FLUSH_SECONDS = int(os.getenv("VISITS_FLUSH_SECONDS", "300"))
MAX_DAYS = 366
GEO_DIR = Path(os.getenv("GEO_DIR", "/code/geo"))
TRACKED_ORIGINS = {"https://shaiknagurshareef.github.io", "http://localhost:4321", "http://127.0.0.1:4321"}

router = APIRouter()

# ---------------------------------------------------------------- enrichment
_city_db = _asn_db = None
try:
    import maxminddb

    if (GEO_DIR / "city.mmdb").exists():
        _city_db = maxminddb.open_database(str(GEO_DIR / "city.mmdb"))
    if (GEO_DIR / "asn.mmdb").exists():
        _asn_db = maxminddb.open_database(str(GEO_DIR / "asn.mmdb"))
except Exception as exc:  # geo is best-effort
    log.warning("geo databases unavailable: %s", exc)

try:
    from user_agents import parse as parse_ua
except Exception:  # pragma: no cover
    parse_ua = None

BOT_RE = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|python-requests|curl|wget|httpx", re.I)


def _geo(ip: str) -> dict:
    out: dict = {}
    try:
        if _city_db:
            r = _city_db.get(ip) or {}
            out["city"] = (r.get("city") or {}).get("names", {}).get("en")
            subs = r.get("subdivisions") or []
            out["region"] = subs[0].get("names", {}).get("en") if subs else None
            out["country"] = (r.get("country") or {}).get("names", {}).get("en")
            out["cc"] = (r.get("country") or {}).get("iso_code")
        if _asn_db:
            r = _asn_db.get(ip) or {}
            out["asn"] = r.get("autonomous_system_number")
            out["org"] = r.get("autonomous_system_organization")
    except Exception:
        pass
    return {k: v for k, v in out.items() if v}


def _mask(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ""
    prefix = 24 if addr.version == 4 else 48
    return str(ipaddress.ip_network(f"{ip}/{prefix}", strict=False).network_address)


def _ip_hash(ip: str) -> str:
    return hmac.new(SALT.encode(), ip.encode(), hashlib.sha256).hexdigest()[:16] if SALT else ""


def _device(ua: str) -> dict:
    if not parse_ua or not ua:
        return {}
    u = parse_ua(ua)
    kind = "mobile" if u.is_mobile else "tablet" if u.is_tablet else "desktop" if u.is_pc else "other"
    return {
        "browser": f"{u.browser.family} {u.browser.version_string.split('.')[0]}".strip(),
        "os": f"{u.os.family} {u.os.version_string}".strip(),
        "device": kind,
    }


def _clip(v, n: int) -> str | None:
    return str(v)[:n] if v not in (None, "") else None


# ---------------------------------------------------------------- storage
_days: dict[str, list[dict]] = {}   # "YYYY-MM-DD" -> records (today + recently touched days)
_dirty: set[str] = set()
_loaded: set[str] = set()
_lock = asyncio.Lock()
_api = None


def _hf():
    global _api
    if _api is None and HF_TOKEN:
        from huggingface_hub import HfApi

        _api = HfApi(token=HF_TOKEN)
        try:
            _api.create_repo(DATASET, repo_type="dataset", private=True, exist_ok=True)
        except Exception as exc:
            log.warning("could not ensure dataset %s: %s", DATASET, exc)
    return _api


def _path(day: str) -> str:
    return f"visits/{day[:4]}/{day}.jsonl"


_files: tuple[float, set[str]] = (0.0, set())
_archive: dict[str, list[dict]] = {}  # days before yesterday never change, so cache them


def _existing() -> set[str] | None:
    """Files currently in the dataset (cached for a minute). None if the Hub is unreachable."""
    global _files
    api = _hf()
    if not api:
        return set()
    if time.time() - _files[0] < 60:
        return _files[1]
    try:
        _files = (time.time(), set(api.list_repo_files(DATASET, repo_type="dataset")))
    except Exception as exc:
        log.warning("list files failed: %s", exc)
        return None
    return _files[1]


def _fetch(day: str) -> list[dict] | None:
    files = _existing()
    if files is None:
        return None
    if _path(day) not in files:
        return []
    try:
        from huggingface_hub import hf_hub_download

        p = hf_hub_download(DATASET, _path(day), repo_type="dataset", token=HF_TOKEN, force_download=True)
        return [json.loads(line) for line in Path(p).read_text().splitlines() if line.strip()]
    except Exception as exc:
        log.warning("fetch %s failed: %s", day, exc)
        return None


def _load_day(day: str) -> list[dict]:
    """Records for a day that is being written to, fetched from the dataset once."""
    if day in _loaded:
        return _days.setdefault(day, [])
    rows = _fetch(day)
    if rows is None:  # Hub unreachable: keep what we have, retry later
        return _days.setdefault(day, [])
    rows.extend(_days.get(day, []))  # merge anything recorded before the load finished
    _days[day] = rows
    _loaded.add(day)
    return rows


def _read_day(day: str, old: bool) -> list[dict]:
    if day in _days and (day in _loaded or not old):
        return _load_day(day)
    if old:
        if day not in _archive:
            rows = _fetch(day)
            if rows is None:
                return []
            _archive[day] = rows
        return _archive[day]
    return _load_day(day)


async def _flush() -> None:
    api = _hf()
    if not api:
        return
    async with _lock:
        days = sorted(_dirty)
        _dirty.clear()
    for day in days:
        rows = await asyncio.to_thread(_load_day, day)
        if day not in _loaded:  # could not read the existing file; never overwrite it blindly
            _dirty.add(day)
            continue
        body = "\n".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) for r in rows) + "\n"
        try:
            await asyncio.to_thread(
                api.upload_file, path_or_fileobj=body.encode(), path_in_repo=_path(day),
                repo_id=DATASET, repo_type="dataset", commit_message=f"visits {day} ({len(rows)})",
            )
            _files[1].add(_path(day))
        except Exception as exc:
            log.warning("flush %s failed: %s", day, exc)
            _dirty.add(day)
    # Keep memory bounded: drop older days that are already saved.
    keep = {(datetime.now(timezone.utc) - timedelta(days=d)).strftime("%Y-%m-%d") for d in range(2)}
    for day in [d for d in _days if d not in keep and d not in _dirty]:
        _days.pop(day, None)
        _loaded.discard(day)


async def flush_loop() -> None:
    while True:
        await asyncio.sleep(FLUSH_SECONDS)
        if _dirty:
            await _flush()


async def flush_now() -> None:
    if _dirty:
        await _flush()


# ---------------------------------------------------------------- endpoints
def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else ""


_recent: dict[str, float] = {}  # per-IP throttle for beacons


@router.post("/v1/visit", status_code=204)
async def visit(request: Request):
    origin = request.headers.get("origin", "")
    if origin not in TRACKED_ORIGINS:
        return Response(status_code=204)
    raw = await request.body()
    if len(raw) > 4096:
        return Response(status_code=204)
    try:
        d = json.loads(raw or b"{}")
    except ValueError:
        return Response(status_code=204)
    if not isinstance(d, dict):
        return Response(status_code=204)

    ip = _client_ip(request)
    now = time.time()
    key = f"{ip}:{d.get('t')}:{d.get('pv')}"  # drop exact duplicates fired within a second
    if now - _recent.get(key, 0) < 1:
        return Response(status_code=204)
    _recent[key] = now
    if len(_recent) > 20000:
        _recent.clear()

    ts = datetime.now(timezone.utc)
    day = ts.strftime("%Y-%m-%d")
    rows = _days.setdefault(day, [])

    if d.get("t") == "leave":
        pv = _clip(d.get("pv"), 40)
        ms = d.get("ms")
        if pv and isinstance(ms, (int, float)) and 0 <= ms < 6 * 3600 * 1000:
            for r in reversed(rows[-500:]):
                if r.get("pv") == pv:
                    r["ms"] = int(ms)
                    _dirty.add(day)
                    break
        return Response(status_code=204)

    ua = request.headers.get("user-agent", "")[:400]
    rec = {
        "ts": ts.isoformat(timespec="seconds"),
        "pv": _clip(d.get("pv"), 40),
        "vid": _clip(d.get("vid"), 40),
        "sid": _clip(d.get("sid"), 40),
        "path": _clip(d.get("path"), 300),
        "title": _clip(d.get("title"), 200),
        "ref": _clip(d.get("ref"), 300),
        "lang": _clip(d.get("lang"), 20),
        "tz": _clip(d.get("tz"), 60),
        "screen": _clip(d.get("screen"), 20),
        "new": bool(d.get("new")),
        "ip": _mask(ip),
        "ip_hash": _ip_hash(ip),
        "ua": ua,
        "bot": bool(BOT_RE.search(ua)) or bool(d.get("wd")),
        **_device(ua),
        **_geo(ip),
    }
    rows.append({k: v for k, v in rec.items() if v not in (None, "")})
    _dirty.add(day)
    return Response(status_code=204)


_fails: list[float] = []


@router.get("/v1/visits")
async def visits(request: Request, days: int = 30):
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    now = time.time()
    _fails[:] = [t for t in _fails if now - t < 600]
    if len(_fails) > 20:
        raise HTTPException(429, "Too many failed attempts. Try again in a few minutes.")
    if not ADMIN_TOKEN or not secrets.compare_digest(token, ADMIN_TOKEN):
        _fails.append(now)
        await asyncio.sleep(1)
        raise HTTPException(401, "Invalid token.")

    days = max(1, min(days, MAX_DAYS))
    today = datetime.now(timezone.utc).date()
    out: list[dict] = []
    for i in range(days):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        out.extend(await asyncio.to_thread(_read_day, day, i >= 2))
    out.sort(key=lambda r: r.get("ts", ""), reverse=True)
    return {
        "days": days,
        "count": len(out),
        "storage": "ok" if _hf() else "memory-only (HF_TOKEN not set)",
        "geo": bool(_city_db),
        "pending": sorted(_dirty),
        "visits": out,
    }
