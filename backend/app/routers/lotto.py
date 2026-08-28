"""Lotto draw & attempt endpoints.

A draw is upserted by date (posting the same date again overwrites that
date's result). Attempts are added, edited, and removed underneath a draw.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

import cache
from app.deps import require_db
from app.schemas.lotto import LottoAttemptCreate, LottoAttemptHiddenUpdate, LottoDrawCreate
from db import (
    delete_lotto_attempt,
    delete_lotto_draw,
    get_lotto_draw_id_by_date,
    insert_lotto_attempt,
    list_lotto_draws,
    set_lotto_attempt_hidden,
    update_lotto_attempt,
    update_lotto_draw,
    upsert_lotto_draw,
)

router = APIRouter(tags=["lotto"], dependencies=[Depends(require_db)])


def _numbers(row: dict[str, Any]) -> list[int]:
    """A draw's winning numbers, or `[]` if the result isn't in yet."""
    if row["n1"] is None:
        return []
    return [row["n1"], row["n2"], row["n3"], row["n4"], row["n5"], row["n6"]]


def _serialize_draw(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "draw_date": row["draw_date"],
        "numbers": _numbers(row),
        "created_at": row["created_at"],
    }


def _serialize_attempt(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "draw_id": row["draw_id"],
        "ticket": row["ticket"],
        "numbers": _numbers(row),
        "hidden": bool(row["hidden"]),
        "created_at": row["created_at"],
    }


def _serialize_detail(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "draw": _serialize_draw(detail["draw"]),
        "attempts": [_serialize_attempt(a) for a in detail["attempts"]],
    }


@router.get("/api/lotto")
def lotto_list(limit: int = Query(default=200, ge=1, le=2000)) -> dict[str, Any]:
    key = f"lotto:list:{limit}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    rows = list_lotto_draws(limit=limit)
    result = {"draws": [_serialize_detail(r) for r in rows]}
    cache.set(key, result)
    return result


@router.post("/api/lotto")
def lotto_set_draw(body: LottoDrawCreate) -> dict[str, Any]:
    detail = upsert_lotto_draw(body.draw_date.isoformat(), body.numbers)
    return _serialize_detail(detail)


@router.put("/api/lotto/{draw_id}")
def lotto_update_draw(draw_id: int, body: LottoDrawCreate) -> dict[str, Any]:
    draw_date = body.draw_date.isoformat()
    existing_id = get_lotto_draw_id_by_date(draw_date)
    if existing_id is not None and existing_id != draw_id:
        raise HTTPException(
            status_code=409, detail="Another result already exists for that date."
        )
    detail = update_lotto_draw(draw_id, draw_date, body.numbers)
    if detail is None:
        raise HTTPException(status_code=404, detail="Draw not found.")
    return _serialize_detail(detail)


@router.delete("/api/lotto/{draw_id}")
def lotto_remove_draw(draw_id: int) -> dict[str, Any]:
    if not delete_lotto_draw(draw_id):
        raise HTTPException(status_code=404, detail="Draw not found.")
    return {"ok": True}


@router.post("/api/lotto/{draw_id}/attempts")
def lotto_add_attempt(draw_id: int, body: LottoAttemptCreate) -> dict[str, Any]:
    detail = insert_lotto_attempt(draw_id, body.numbers, body.ticket)
    if detail is None:
        raise HTTPException(status_code=404, detail="Draw not found.")
    return _serialize_detail(detail)


@router.put("/api/lotto/{draw_id}/attempts/{attempt_id}")
def lotto_update_attempt(
    draw_id: int, attempt_id: int, body: LottoAttemptCreate
) -> dict[str, Any]:
    detail = update_lotto_attempt(draw_id, attempt_id, body.numbers, body.ticket)
    if detail is None:
        raise HTTPException(status_code=404, detail="Attempt not found.")
    return _serialize_detail(detail)


@router.delete("/api/lotto/{draw_id}/attempts/{attempt_id}")
def lotto_remove_attempt(draw_id: int, attempt_id: int) -> dict[str, Any]:
    detail = delete_lotto_attempt(draw_id, attempt_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Attempt not found.")
    return _serialize_detail(detail)


@router.put("/api/lotto/{draw_id}/attempts/{attempt_id}/hidden")
def lotto_set_attempt_hidden(
    draw_id: int, attempt_id: int, body: LottoAttemptHiddenUpdate
) -> dict[str, Any]:
    detail = set_lotto_attempt_hidden(draw_id, attempt_id, body.hidden)
    if detail is None:
        raise HTTPException(status_code=404, detail="Attempt not found.")
    return _serialize_detail(detail)
