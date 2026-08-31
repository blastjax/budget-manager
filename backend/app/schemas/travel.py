"""Travel trip API models.

A trip is filed under an entry year + month (like a journal entry) and holds
three kinds of nested records: flights, itinerary items, and accommodations.
Locations on itinerary/accommodation rows (and a flight's origin/destination)
carry an optional custom Google Maps link; when one isn't set, the frontend
builds a maps search link from the location's name instead.
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field, field_validator, model_validator


def _clean_optional(v: str | None) -> str | None:
    if v is None:
        return None
    trimmed = v.strip()
    return trimmed or None


def _require_text(v: str, label: str) -> str:
    trimmed = v.strip()
    if not trimmed:
        raise ValueError(f"{label} is required.")
    return trimmed


class TravelTripCreate(BaseModel):
    title: str = Field(min_length=1)
    entry_year: int = Field(ge=1900, le=2999)
    entry_month: int = Field(ge=1, le=12)
    notes: str | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        return _require_text(v, "Title")

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return _clean_optional(v)


class TravelFlightCreate(BaseModel):
    flight_number: str = Field(min_length=1)
    flight_date: dt.date | None = None
    departure_time: str | None = None
    arrival_time: str | None = None
    from_location: str | None = None
    from_map_url: str | None = None
    to_location: str | None = None
    to_map_url: str | None = None
    notes: str | None = None

    @field_validator("flight_number")
    @classmethod
    def _flight_number(cls, v: str) -> str:
        return _require_text(v, "Flight number")

    @field_validator(
        "departure_time",
        "arrival_time",
        "from_location",
        "from_map_url",
        "to_location",
        "to_map_url",
        "notes",
    )
    @classmethod
    def _optional(cls, v: str | None) -> str | None:
        return _clean_optional(v)


class TravelItineraryCreate(BaseModel):
    item_date: dt.date
    start_time: str | None = None
    end_time: str | None = None
    activity: str = Field(min_length=1)
    location_name: str | None = None
    location_map_url: str | None = None
    notes: str | None = None

    @field_validator("activity")
    @classmethod
    def _activity(cls, v: str) -> str:
        return _require_text(v, "Activity")

    @field_validator("start_time", "end_time", "location_name", "location_map_url", "notes")
    @classmethod
    def _optional(cls, v: str | None) -> str | None:
        return _clean_optional(v)


class TravelAccommodationCreate(BaseModel):
    name: str = Field(min_length=1)
    checkin_date: dt.date
    checkout_date: dt.date
    checkin_time: str | None = None
    checkout_time: str | None = None
    booking_confirmation: str | None = None
    instructions: str | None = None
    location_name: str | None = None
    location_map_url: str | None = None
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _require_text(v, "Name")

    @field_validator(
        "checkin_time",
        "checkout_time",
        "booking_confirmation",
        "instructions",
        "location_name",
        "location_map_url",
        "notes",
    )
    @classmethod
    def _optional(cls, v: str | None) -> str | None:
        return _clean_optional(v)

    @model_validator(mode="after")
    def _checkout_after_checkin(self) -> "TravelAccommodationCreate":
        if self.checkout_date < self.checkin_date:
            raise ValueError("Check-out date must be on or after check-in date.")
        return self
