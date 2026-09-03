"""Lotto draw & attempt endpoints.

A draw is the official result for one date: 6 winning numbers, the jackpot
prize at stake, and how many tickets won it. A draw is upserted by date
(posting the same date again overwrites that date's result) — including via
``POST /api/lotto/import``, which bulk-loads a pipe-delimited historic
results text file in one shot. Attempts are the user's own picks, added,
edited, and removed underneath a draw — linked to it (and so to its date)
via ``draw_id``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

import cache
from app.deps import require_db
from app.schemas.lotto import LottoAttemptCreate, LottoAttemptHiddenUpdate, LottoDrawCreate
from app.services.lotto_analysis import LottoAnalysis, NumberStat, PairStat, analyze_draws
from app.services.lotto_import import import_rows_to_bulk_params, parse_lotto_draw_text
from db import (
    delete_lotto_attempt,
    delete_lotto_draw,
    get_lotto_draw_id_by_date,
    insert_lotto_attempt,
    list_lotto_draw_numbers,
    list_lotto_draws,
    set_lotto_attempt_hidden,
    update_lotto_attempt,
    update_lotto_draw,
    upsert_lotto_draw,
    upsert_lotto_draws_bulk,
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
        "jackpot_prize": row["jackpot_prize"],
        "winners": row["winners"],
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


def _serialize_number_stat(s: NumberStat) -> dict[str, Any]:
    return {"number": s.number, "count": s.count, "draws_since_seen": s.draws_since_seen}


def _serialize_pair_stat(p: PairStat) -> dict[str, Any]:
    return {"numbers": list(p.numbers), "count": p.count}


def _serialize_analysis(a: LottoAnalysis) -> dict[str, Any]:
    return {
        "draw_count": a.draw_count,
        "numbers": [_serialize_number_stat(s) for s in a.numbers],
        "hottest": [_serialize_number_stat(s) for s in a.hottest],
        "coldest": [_serialize_number_stat(s) for s in a.coldest],
        "most_overdue": [_serialize_number_stat(s) for s in a.most_overdue],
        "top_pairs": [_serialize_pair_stat(p) for p in a.top_pairs],
        "expected_count_per_number": a.expected_count_per_number,
        "chi_square": a.chi_square,
        "chi_square_p_value": a.chi_square_p_value,
        "degrees_of_freedom": a.degrees_of_freedom,
        "sum_mean": a.sum_mean,
        "sum_stdev": a.sum_stdev,
        "theoretical_sum_mean": a.theoretical_sum_mean,
        "odd_count": a.odd_count,
        "even_count": a.even_count,
        "low_count": a.low_count,
        "high_count": a.high_count,
        "consecutive_number_draws": a.consecutive_number_draws,
        "repeat_from_previous_draw_avg": a.repeat_from_previous_draw_avg,
        "theoretical_repeat_avg": a.theoretical_repeat_avg,
    }


@router.get("/api/lotto/analysis")
def lotto_analysis(top: int = Query(default=10, ge=1, le=58)) -> dict[str, Any]:
    """Descriptive stats over every draw with an announced result — hot/cold/
    overdue numbers, common pairs, and a goodness-of-fit check for whether the
    history looks like a fair, random draw. See `app.services.lotto_analysis`
    for what each field means and how it's computed."""
    rows = list_lotto_draw_numbers()
    if not rows:
        raise HTTPException(status_code=404, detail="No draws with results yet to analyze.")
    draws = [_numbers(r) for r in rows]
    return _serialize_analysis(analyze_draws(draws, top_n=top))


@router.post("/api/lotto")
def lotto_set_draw(body: LottoDrawCreate) -> dict[str, Any]:
    detail = upsert_lotto_draw(
        body.draw_date.isoformat(), body.numbers, body.jackpot_prize, body.winners
    )
    return _serialize_detail(detail)


@router.post("/api/lotto/import")
async def lotto_import(file: UploadFile = File(...)) -> dict[str, Any]:
    """Bulk-load historic results from a pipe-delimited text file — one row
    per draw: ``| n1-n2-n3-n4-n5-n6 | m/d/yyyy | jackpot | winners |``. Each
    row is upserted by date (same rule as ``POST /api/lotto``), so re-uploading
    the same file — or a newer export that also fills in jackpot/winner
    columns for draws already in the database — overwrites rather than
    duplicating."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 text.")
    parsed, errors = parse_lotto_draw_text(text)
    if not parsed:
        detail = "No valid draw rows found."
        if errors:
            detail += f" First error — {errors[0]}"
        raise HTTPException(status_code=400, detail=detail)
    summary = upsert_lotto_draws_bulk(import_rows_to_bulk_params(parsed))
    return {"filename": file.filename, **summary, "errors": errors}


@router.put("/api/lotto/{draw_id}")
def lotto_update_draw(draw_id: int, body: LottoDrawCreate) -> dict[str, Any]:
    draw_date = body.draw_date.isoformat()
    existing_id = get_lotto_draw_id_by_date(draw_date)
    if existing_id is not None and existing_id != draw_id:
        raise HTTPException(
            status_code=409, detail="Another result already exists for that date."
        )
    detail = update_lotto_draw(
        draw_id, draw_date, body.numbers, body.jackpot_prize, body.winners
    )
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
