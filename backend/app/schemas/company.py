"""Company management API models (Settings → Companies). See app/routers/company.py."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

    @model_validator(mode="after")
    def _check_name(self) -> "CompanyCreate":
        if not self.name.strip():
            raise ValueError("Company name cannot be blank.")
        return self


class CompanyUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

    @model_validator(mode="after")
    def _check_name(self) -> "CompanyUpdate":
        if not self.name.strip():
            raise ValueError("Company name cannot be blank.")
        return self


class CompanyReorder(BaseModel):
    """Every company id, in the desired display order (top to bottom)."""

    ids: list[int] = Field(..., min_length=1)
