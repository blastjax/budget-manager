"""Username/password session authentication.

Credentials live in the ``app_user`` table (see ``db.py`` / Settings →
Users), hashed with Argon2id (``app.passwords``). A successful login (see
``app/routers/auth.py``) mints an opaque session token. The frontend stores
that token in ``sessionStorage`` rather than ``localStorage``, so it
disappears — and a fresh login is required — whenever the browser restarts,
while surviving reloads/tab switches within the same browser session. The
TTL below is just a server-side safety net for that same lifetime, not the
primary boundary.

Until at least one user exists, auth is treated as not configured and
``require_session`` (see ``app.deps``) lets every request through — so a
fresh checkout stays usable until a user is deliberately added.
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Any

import cache

_SESSION_PREFIX = "auth_session"
_FAIL_PREFIX = "auth_fail"

_MAX_FAILED_ATTEMPTS = 8
_FAIL_WINDOW_SECONDS = 15 * 60


class _ExpiringStore:
    """Tiny in-process TTL map, used only while Redis is unavailable.

    Redis stays the primary store so sessions survive an API restart. This
    fallback exists because ``cache.*`` degrades to silent no-ops when Redis
    is down, which previously made ``/api/auth/login`` hand out tokens that
    could never validate — an unbreakable login loop with no error shown.

    Being per-process, it is only coherent while the API runs a single worker
    (see ``docker/Dockerfile.backend``). Adding ``--workers`` would stop
    sessions being shared between them, making Redis effectively required.
    """

    def __init__(self) -> None:
        self._items: dict[str, tuple[float, Any]] = {}

    def set(self, key: str, value: Any, ttl: int) -> None:
        self._prune()
        self._items[key] = (time.monotonic() + ttl, value)

    def get(self, key: str) -> Any | None:
        item = self._items.get(key)
        if item is None:
            return None
        expiry, value = item
        if expiry <= time.monotonic():
            del self._items[key]
            return None
        return value

    def delete(self, key: str) -> None:
        self._items.pop(key, None)

    def _prune(self) -> None:
        now = time.monotonic()
        for key in [k for k, (expiry, _) in self._items.items() if expiry <= now]:
            del self._items[key]


_fallback = _ExpiringStore()


def _store_set(key: str, value: Any, ttl: int) -> None:
    """Write to Redis, falling back to the in-process store when it's down.

    The read-back is how we detect an unavailable Redis (``cache.set`` can't
    report failure). Only login-shaped events write here — a handful per
    browser session — so the extra round trip doesn't matter.
    """
    cache.set(key, value, ttl=ttl)
    if cache.get(key) is None:
        _fallback.set(key, value, ttl)


def _store_get(key: str) -> Any | None:
    hit = cache.get(key)
    return hit if hit is not None else _fallback.get(key)


def _store_delete(key: str) -> None:
    cache.delete(key)
    _fallback.delete(key)


def _session_ttl_seconds() -> int:
    return int(os.environ.get("BUDGET_SESSION_TTL_SECONDS", str(12 * 3600)))


def create_session() -> str:
    token = secrets.token_urlsafe(32)
    _store_set(f"{_SESSION_PREFIX}:{token}", True, _session_ttl_seconds())
    return token


def session_is_valid(token: str) -> bool:
    if not token:
        return False
    return _store_get(f"{_SESSION_PREFIX}:{token}") is not None


def revoke_session(token: str) -> None:
    if token:
        _store_delete(f"{_SESSION_PREFIX}:{token}")


def too_many_failed_attempts(client_ip: str) -> bool:
    count = _store_get(f"{_FAIL_PREFIX}:{client_ip}") or 0
    return int(count) >= _MAX_FAILED_ATTEMPTS


def record_failed_attempt(client_ip: str) -> None:
    key = f"{_FAIL_PREFIX}:{client_ip}"
    count = int(_store_get(key) or 0) + 1
    _store_set(key, count, _FAIL_WINDOW_SECONDS)


def clear_failed_attempts(client_ip: str) -> None:
    _store_delete(f"{_FAIL_PREFIX}:{client_ip}")
