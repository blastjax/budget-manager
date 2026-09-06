"""Company management (Settings → Companies). Each payslip is tagged with a
company name (see app/routers/payslip.py), and this is the managed list those
tags are drawn from. Like every other protected router this still gates on a
valid session via require_session."""

from __future__ import annotations

import psycopg2
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.deps import require_db
from app.schemas.company import CompanyCreate, CompanyUpdate
from db import (
    delete_company,
    insert_company,
    list_companies,
    update_company,
)

router = APIRouter(prefix="/api/companies", tags=["companies"], dependencies=[Depends(require_db)])


def _serialize(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    v = out.get("created_at")
    if hasattr(v, "isoformat"):
        out["created_at"] = v.isoformat()
    return out


@router.get("")
def companies_list() -> dict[str, Any]:
    return {"companies": [_serialize(r) for r in list_companies()]}


@router.post("")
def companies_create(body: CompanyCreate) -> dict[str, Any]:
    try:
        row = insert_company(body.name.strip())
    except psycopg2.IntegrityError:
        raise HTTPException(status_code=409, detail="That company already exists.")
    return {"company": _serialize(row)}


@router.put("/{company_id}")
def companies_update(company_id: int, body: CompanyUpdate) -> dict[str, Any]:
    try:
        row = update_company(company_id, body.name.strip())
    except psycopg2.IntegrityError:
        raise HTTPException(status_code=409, detail="That company already exists.")
    if row is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    return {"company": _serialize(row)}


@router.delete("/{company_id}")
def companies_remove(company_id: int) -> dict[str, Any]:
    try:
        deleted = delete_company(company_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found.")
    return {"ok": True}
