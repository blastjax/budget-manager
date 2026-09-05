"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import HTTPException, Request

from app.security import session_is_valid
from db import any_app_users, database_url


def require_db() -> None:
    """Reject requests when no database is configured.

    Used as a route dependency so each router doesn't have to repeat the
    same precondition check::

        @router.get("/api/foo", dependencies=[Depends(require_db)])
        def foo(): ...
    """
    if not database_url():
        raise HTTPException(status_code=503, detail="DATABASE_URL is not set.")


def require_session(request: Request) -> None:
    """Reject requests without a valid login session token.

    Applied once, to every protected router, via ``include_router(...,
    dependencies=[Depends(require_session)])`` in the app factory — no-op
    until at least one user has been added (Settings → Users), so login is
    opt-in the same way OTP used to be.
    """
    if not any_app_users():
        return
    header = request.headers.get("authorization") or ""
    token = header[7:] if header.lower().startswith("bearer ") else ""
    if not session_is_valid(token):
        raise HTTPException(status_code=401, detail="Login required.")
