"""Contact messages and visitor feedback for the portfolio.

POST /v1/contact      a message to Shareef; forwarded to his email (FormSubmit relay, free, no key)
                      with the sender as Reply-To, and kept in the private dataset as a backup.
POST /v1/feedback     feedback about Shareef; private until he approves it.
GET  /v1/feedback     approved feedback (public: name, relation, text, date).
GET  /v1/admin/inbox  all messages and feedback (audit password).
POST /v1/admin/feedback/{id}  {"status": "approved" | "hidden" | "pending"} (audit password).

Spam controls: allowed origins only, a honeypot field, a minimum fill time, per-IP rate limits,
length and link-count limits. Stored in the same private HF dataset as the visit log.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import visits

log = logging.getLogger("portfolio-inbox")
router = APIRouter()

CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "shaiknagurshareef6@gmail.com")
RELAY_URL = f"https://formsubmit.co/ajax/{CONTACT_EMAIL}"
SITE = "https://shaiknagurshareef.github.io"
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
URL_RE = re.compile(r"https?://|www\.", re.I)
MIN_FILL_MS = 2500

# ---------------------------------------------------------------- storage (one JSONL file per kind)
_store: dict[str, list[dict]] = {}
_lock = asyncio.Lock()


def _path(kind: str) -> str:
    return f"inbox/{kind}.jsonl"


def _load(kind: str) -> list[dict]:
    if kind in _store:
        return _store[kind]
    rows: list[dict] = []
    api = visits._hf()
    if api:
        try:
            files = set(api.list_repo_files(visits.DATASET, repo_type="dataset"))
            if _path(kind) in files:
                from huggingface_hub import hf_hub_download

                p = hf_hub_download(visits.DATASET, _path(kind), repo_type="dataset", token=visits.HF_TOKEN, force_download=True)
                rows = [json.loads(line) for line in Path(p).read_text().splitlines() if line.strip()]
        except Exception as exc:  # unreachable Hub: start empty in memory, but do not overwrite later
            log.warning("load %s failed: %s", kind, exc)
            return _store.setdefault(f"_unsaved_{kind}", [])
    rows.extend(_store.pop(f"_unsaved_{kind}", []))  # anything received while the Hub was unreachable
    _store[kind] = rows
    return rows


async def _rows(kind: str) -> list[dict]:
    return await asyncio.to_thread(_load, kind)


async def _save(kind: str) -> None:
    api = visits._hf()
    if not api or kind not in _store:
        return
    body = "\n".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) for r in _store[kind]) + "\n"
    try:
        await asyncio.to_thread(
            api.upload_file, path_or_fileobj=body.encode(), path_in_repo=_path(kind),
            repo_id=visits.DATASET, repo_type="dataset", commit_message=f"{kind} ({len(_store[kind])})",
        )
    except Exception as exc:
        log.warning("save %s failed: %s", kind, exc)


# ---------------------------------------------------------------- spam controls
_hits: dict[str, list[float]] = {}


def _guard(request: Request, honeypot: str, elapsed: int) -> None:
    if request.headers.get("origin", "") not in visits.TRACKED_ORIGINS:
        raise HTTPException(403, "Please use the form on the website.")
    if honeypot or elapsed < MIN_FILL_MS:
        raise HTTPException(400, "Your message could not be sent. Please try again.")
    ip, now = visits._client_ip(request), time.time()
    recent = [t for t in _hits.get(ip, []) if now - t < 86400]
    if len([t for t in recent if now - t < 600]) >= 3 or len(recent) >= 10:
        raise HTTPException(429, "You've sent several messages already. Please try again later, or email directly.")
    _hits[ip] = recent + [now]
    if len(_hits) > 5000:
        _hits.clear()


def _clean(s: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s).strip()


def _sender_meta(request: Request) -> dict:
    ip = visits._client_ip(request)
    geo = visits._geo(ip)
    return {k: v for k, v in {
        "ip": visits._mask(ip), "org": geo.get("org"), "city": geo.get("city"), "country": geo.get("country"),
        "ua": request.headers.get("user-agent", "")[:300],
    }.items() if v}


async def _relay(fields: dict) -> bool:
    """Forward to Shareef's inbox. Returns True when the relay accepted it."""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                RELAY_URL, json={**fields, "_captcha": "false", "_template": "table"},
                headers={"Accept": "application/json", "Origin": SITE, "Referer": f"{SITE}/contact/"},
            )
        try:  # the relay answers with JSON but labels it text/html
            data = json.loads(r.text)
        except ValueError:
            data = {}
        ok = str(data.get("success", "")).lower() == "true"
        if not ok:
            log.warning("relay declined (%s): %s", r.status_code, str(data)[:200])
        return ok
    except Exception as exc:
        log.warning("relay failed: %s", exc)
        return False


# ---------------------------------------------------------------- contact
class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=5, max_length=200)
    subject: str = Field(default="", max_length=150)
    message: str = Field(min_length=10, max_length=5000)
    website: str = Field(default="", max_length=200)  # honeypot: humans leave it empty
    elapsed: int = 0                                    # ms between page load and submit


@router.post("/v1/contact")
async def contact(body: ContactIn, request: Request):
    _guard(request, body.website, body.elapsed)
    name, email, subject, message = (_clean(x) for x in (body.name, body.email, body.subject, body.message))
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Please enter a valid email address so I can reply.")
    if len(URL_RE.findall(message)) > 3:
        raise HTTPException(422, "Please include at most three links.")
    rec = {
        "id": secrets.token_hex(6), "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "name": name, "email": email, "subject": subject, "message": message, **_sender_meta(request),
    }
    rec["delivered"] = await _relay({
        "name": name, "email": email, "_replyto": email,
        "_subject": f"Portfolio message: {subject or 'from ' + name}", "message": message,
    })
    async with _lock:
        (await _rows("messages")).append(rec)
    asyncio.create_task(_save("messages"))
    return {"ok": True, "delivered": rec["delivered"]}


# ---------------------------------------------------------------- feedback
class FeedbackIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    relation: str = Field(default="", max_length=120)    # e.g. "Colleague at UST"
    email: str = Field(default="", max_length=200)       # optional, never shown
    message: str = Field(min_length=10, max_length=2000)
    public: bool = False                                  # consent to show on the site
    website: str = Field(default="", max_length=200)
    elapsed: int = 0


@router.post("/v1/feedback")
async def feedback(body: FeedbackIn, request: Request):
    _guard(request, body.website, body.elapsed)
    name, relation, email, message = (_clean(x) for x in (body.name, body.relation, body.email, body.message))
    if email and not EMAIL_RE.match(email):
        raise HTTPException(422, "That email address doesn't look right (it's optional).")
    if len(URL_RE.findall(message)) > 1:
        raise HTTPException(422, "Please leave links out of feedback.")
    rec = {
        "id": secrets.token_hex(6), "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "name": name, "relation": relation, "email": email, "message": message,
        "public": body.public, "status": "pending", **_sender_meta(request),
    }
    async with _lock:
        (await _rows("feedback")).append(rec)
    asyncio.create_task(_save("feedback"))
    asyncio.create_task(_relay({
        "name": name, "email": email or "not given", **({"_replyto": email} if email else {}),
        "_subject": f"Portfolio feedback from {name}" + (" (may be shown publicly)" if body.public else ""),
        "relation": relation or "not given", "message": message,
        "next step": "Approve or hide it on https://shaiknagurshareef.github.io/audit/",
    }))
    return {"ok": True}


@router.get("/v1/feedback")
async def public_feedback():
    rows = await _rows("feedback")
    shown = [r for r in rows if r.get("status") == "approved" and r.get("public")]
    shown.sort(key=lambda r: r.get("ts", ""), reverse=True)
    return {"feedback": [{"id": r["id"], "name": r["name"], "relation": r.get("relation", ""), "message": r["message"], "date": r["ts"][:10]} for r in shown[:50]]}


# ---------------------------------------------------------------- admin
@router.get("/v1/admin/inbox")
async def admin_inbox(request: Request):
    await visits.require_admin(request)
    messages = sorted(await _rows("messages"), key=lambda r: r.get("ts", ""), reverse=True)
    fb = sorted(await _rows("feedback"), key=lambda r: r.get("ts", ""), reverse=True)
    return {"messages": messages, "feedback": fb, "storage": "ok" if visits._hf() else "memory-only (HF_TOKEN not set)"}


class StatusIn(BaseModel):
    status: str = Field(pattern="^(approved|hidden|pending)$")


@router.post("/v1/admin/feedback/{fid}")
async def admin_feedback(fid: str, body: StatusIn, request: Request):
    await visits.require_admin(request)
    async with _lock:
        rows = await _rows("feedback")
        rec = next((r for r in rows if r.get("id") == fid), None)
        if not rec:
            raise HTTPException(404, "Not found.")
        rec["status"] = body.status
    asyncio.create_task(_save("feedback"))
    return {"ok": True, "id": fid, "status": body.status}
