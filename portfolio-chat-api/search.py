"""Semantic search over the site's own search index (no LLM, no external service).

- The site publishes /search-index.json. It is fetched in the background at startup and every
  SEARCH_REFRESH_S seconds (conditional GET with If-None-Match, plus a hash of the document texts),
  re-embedded only when it changed, and swapped in atomically as one immutable object.
- Embeddings come from BAAI/bge-small-en-v1.5 through fastembed (ONNX Runtime, no torch). The model
  is baked into the image at build time (FASTEMBED_CACHE_PATH) and loaded from local files.
- The "vector database" is an L2-normalised float32 matrix held in memory: a few hundred rows, so a
  query is one matrix-vector product plus argpartition.
- Query embeddings are cached in an LRU. Embedding runs in the thread pool behind a lock, with a
  small ONNX thread count, so the event loop (and /chat, /v1/visit, inbox) stays responsive.
- Search queries are never logged or stored.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import threading
import time
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

import visits  # same client-IP helper the app uses for its other rate limits

log = logging.getLogger("portfolio-search")

MODEL_NAME = "BAAI/bge-small-en-v1.5"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
INDEX_URL = os.getenv("SEARCH_INDEX_URL", "https://shaiknagurshareef.github.io/search-index.json")
CACHE_DIR = os.getenv("FASTEMBED_CACHE_PATH") or None
THREADS = int(os.getenv("SEARCH_THREADS", "2"))
REFRESH_S = int(os.getenv("SEARCH_REFRESH_S", "1800"))
RETRY_S = 60  # retry sooner while the first index has not loaded
MAX_Q, DEFAULT_K, MAX_K = 200, 20, 40
RATE_LIMIT, RATE_WINDOW = int(os.getenv("RATE_SEARCH_PER_IP", "60")), 60
QUERY_CACHE_SIZE = 512
DOC_BATCH = 16  # documents per embedding call, so a refresh never blocks queries for long

router = APIRouter()


@dataclass(frozen=True)
class Index:
    urls: tuple[str, ...]
    vectors: np.ndarray  # (n, 384) float32, rows L2-normalised
    digest: str
    etag: str | None
    as_of: str


_model = None
_model_lock = threading.Lock()
_index: Index | None = None
_etag: str | None = None
_qcache: "OrderedDict[str, np.ndarray]" = OrderedDict()
_qcache_lock = threading.Lock()
_hits: dict = defaultdict(deque)


# ---------------------------------------------------------------- model
def _load_model():
    from fastembed import TextEmbedding

    try:
        return TextEmbedding(MODEL_NAME, cache_dir=CACHE_DIR, threads=THREADS, local_files_only=True)
    except Exception as exc:  # noqa: BLE001 - not baked into this environment (local dev)
        log.warning("model not in local cache (%s); downloading", type(exc).__name__)
        return TextEmbedding(MODEL_NAME, cache_dir=CACHE_DIR, threads=THREADS)


def _normalise(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float32)
    norms = np.linalg.norm(m, axis=-1, keepdims=True)
    return m / np.maximum(norms, 1e-12)


def _embed(texts: list[str]) -> np.ndarray:
    with _model_lock:
        return _normalise(np.stack(list(_model.embed(texts, batch_size=len(texts)))))


def _cached(key: str) -> np.ndarray | None:
    with _qcache_lock:
        vec = _qcache.get(key)
        if vec is not None:
            _qcache.move_to_end(key)
        return vec


def _query_vector(key: str) -> np.ndarray:
    vec = _cached(key)
    if vec is not None:
        return vec
    vec = _embed([QUERY_PREFIX + key])[0]
    vec.setflags(write=False)
    with _qcache_lock:
        _qcache[key] = vec
        _qcache.move_to_end(key)
        while len(_qcache) > QUERY_CACHE_SIZE:
            _qcache.popitem(last=False)
    return vec


# ---------------------------------------------------------------- index
def _documents(items: list) -> tuple[list[str], list[str]]:
    """(urls, texts): one document per unique url, first occurrence wins."""
    urls, texts, seen = [], [], set()
    for it in items:
        if not isinstance(it, dict):
            continue
        url = it.get("url")
        if not isinstance(url, str) or not url or url in seen:
            continue
        text = it.get("text")
        if not (isinstance(text, str) and text.strip()):
            parts = [it.get("title"), it.get("subtitle"), it.get("keywords")]
            text = ". ".join(p.strip() for p in parts if isinstance(p, str) and p.strip())
        if not text.strip():
            continue
        seen.add(url)
        urls.append(url)
        texts.append(" ".join(text.split()))
    return urls, texts


def _build(urls: list[str], texts: list[str], digest: str, etag: str | None) -> Index:
    rows = [_embed(texts[i : i + DOC_BATCH]) for i in range(0, len(texts), DOC_BATCH)]
    vectors = np.ascontiguousarray(np.vstack(rows), dtype=np.float32)
    vectors.setflags(write=False)
    as_of = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return Index(urls=tuple(urls), vectors=vectors, digest=digest, etag=etag, as_of=as_of)


async def _refresh(client: httpx.AsyncClient) -> None:
    global _index, _etag
    headers = {"If-None-Match": _etag} if (_etag and _index is not None) else {}
    resp = await client.get(INDEX_URL, headers=headers)
    if resp.status_code == 304:
        return
    resp.raise_for_status()
    items = resp.json()
    if not isinstance(items, list):
        raise ValueError("search index is not a JSON array")
    urls, texts = _documents(items)
    if not urls:
        raise ValueError("search index has no usable items")
    digest = hashlib.sha256("\n".join(f"{u}\t{t}" for u, t in zip(urls, texts)).encode()).hexdigest()
    etag = resp.headers.get("etag")
    if _index is not None and _index.digest == digest:
        _etag = etag
        return
    started = time.perf_counter()
    new = await run_in_threadpool(_build, urls, texts, digest, etag)
    _index, _etag = new, etag  # atomic swap: requests read _index once
    log.info("search index ready: %d items in %.1fs", len(urls), time.perf_counter() - started)


async def index_loop() -> None:
    """Background task: load the model, build the index, then keep it fresh."""
    global _model
    while _model is None:
        try:
            _model = await run_in_threadpool(_load_model)
        except Exception as exc:  # noqa: BLE001
            log.warning("search model failed to load (%s): %s", type(exc).__name__, exc)
            await asyncio.sleep(RETRY_S)
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        while True:
            try:
                await _refresh(client)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("search index refresh failed (%s): %s", type(exc).__name__, exc)
            await asyncio.sleep(REFRESH_S if _index is not None else RETRY_S)


# ---------------------------------------------------------------- routes
def _check_rate(request: Request) -> None:
    now = time.monotonic()
    ip = visits._client_ip(request) or "unknown"
    q = _hits[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "Too many searches. Try again shortly.")
    q.append(now)
    if len(_hits) > 5000:  # bound memory
        for key in [k for k, v in _hits.items() if not v or now - v[-1] > RATE_WINDOW]:
            _hits.pop(key, None)


async def _params(request: Request) -> tuple[str, int]:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Body must be JSON: {\"q\": string, \"k\": int}.") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be JSON: {\"q\": string, \"k\": int}.")
    q = body.get("q")
    if not isinstance(q, str) or not (1 <= len(q.strip()) <= MAX_Q):
        raise HTTPException(400, f"q must be 1 to {MAX_Q} characters.")
    k = body.get("k", DEFAULT_K)
    if k is None:
        k = DEFAULT_K
    if isinstance(k, bool) or not isinstance(k, (int, float)):
        raise HTTPException(400, "k must be an integer.")
    return q.strip(), max(1, min(MAX_K, int(k)))


@router.post("/search")
async def search(request: Request):
    started = time.perf_counter()
    _check_rate(request)
    q, k = await _params(request)
    index = _index  # read once; a refresh swaps the whole object
    if index is None or _model is None:
        raise HTTPException(503, "Search index is loading.")

    key = " ".join(q.lower().split())  # the model's tokenizer is uncased
    vec = _cached(key)  # cache hits skip the thread pool
    if vec is None:
        vec = await run_in_threadpool(_query_vector, key)

    scores = index.vectors @ vec
    n = scores.shape[0]
    k = min(k, n)
    top = np.argpartition(-scores, k - 1)[:k] if k < n else np.arange(n)
    top = top[np.argsort(-scores[top], kind="stable")]
    results = [{"url": index.urls[i], "score": round(float(scores[i]), 3)} for i in top]
    return {
        "results": results,
        "took_ms": round((time.perf_counter() - started) * 1000, 2),
        "indexed": n,
        "model": MODEL_NAME,
    }


@router.get("/search/health")
async def search_health():
    index = _index
    return {
        "ready": index is not None and _model is not None,
        "indexed": len(index.urls) if index else 0,
        "model": MODEL_NAME,
        "index_as_of": index.as_of if index else None,
        "source": INDEX_URL,
    }
