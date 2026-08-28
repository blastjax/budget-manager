"""Lotto draw & attempt API models.

A draw is the official result for one date: 6 unique numbers, 1-58. Attempts
are the user's own picks checked against that date's draw, stored the same
shape.
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field, field_validator


class LottoNumbers(BaseModel):
    numbers: list[int] = Field(min_length=6, max_length=6)

    @field_validator("numbers")
    @classmethod
    def _check_numbers(cls, v: list[int]) -> list[int]:
        if any(n < 1 or n > 58 for n in v):
            raise ValueError("Numbers must be between 1 and 58.")
        if len(set(v)) != len(v):
            raise ValueError("Numbers must be unique.")
        return sorted(v)


class LottoDrawCreate(BaseModel):
    draw_date: dt.date
    # Optional: a draw can be logged by date alone before its winning numbers
    # are announced, so attempts can be recorded ahead of the actual draw.
    numbers: list[int] | None = None

    @field_validator("numbers")
    @classmethod
    def _check_numbers(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return None
        if len(v) != 6:
            raise ValueError("Enter exactly 6 numbers, or leave blank until the result is known.")
        if any(n < 1 or n > 58 for n in v):
            raise ValueError("Numbers must be between 1 and 58.")
        if len(set(v)) != len(v):
            raise ValueError("Numbers must be unique.")
        return sorted(v)


class LottoAttemptCreate(LottoNumbers):
    # Groups this attempt with the other board plays on the same physical
    # ticket (up to a handful of picks per ticket), so the UI can cluster
    # them. None means the attempt isn't part of a ticket group.
    ticket: int | None = None
