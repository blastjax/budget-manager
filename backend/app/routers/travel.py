"""Travel trip endpoints.

A trip is one travel entry, filed under an entry year + month (like the
payslip/monthly-expense period fields elsewhere in this app), holding three
kinds of nested records: flights, itinerary items, and accommodations —
each managed via its own sub-route and always returning the trip's full,
refreshed detail so the frontend never has to re-fetch separately.

An accommodation's nights/days are derived from its check-in/check-out
dates on every read rather than stored, so they can never drift out of sync
with the dates themselves.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

import cache
from app.deps import require_db
from app.schemas.travel import (
    TravelAccommodationCreate,
    TravelFlightCreate,
    TravelItineraryCreate,
    TravelTripCreate,
)
from db import (
    delete_travel_accommodation,
    delete_travel_flight,
    delete_travel_itinerary,
    delete_travel_trip,
    insert_travel_accommodation,
    insert_travel_flight,
    insert_travel_itinerary,
    insert_travel_trip,
    list_travel_trips,
    update_travel_accommodation,
    update_travel_flight,
    update_travel_itinerary,
    update_travel_trip,
)

router = APIRouter(tags=["travel"], dependencies=[Depends(require_db)])


def _nights_and_days(checkin: str, checkout: str) -> tuple[int, int]:
    """Nights = full nights between the two dates; days always counts the
    check-in day, so a same-day stay is 0 nights / 1 day rather than 0/0."""
    ci = dt.date.fromisoformat(checkin)
    co = dt.date.fromisoformat(checkout)
    nights = max(0, (co - ci).days)
    return nights, nights + 1


def _serialize_flight(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "trip_id": row["trip_id"],
        "flight_number": row["flight_number"],
        "flight_date": row["flight_date"],
        "departure_time": row["departure_time"],
        "arrival_time": row["arrival_time"],
        "from_location": row["from_location"],
        "from_map_url": row["from_map_url"],
        "to_location": row["to_location"],
        "to_map_url": row["to_map_url"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _serialize_itinerary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "trip_id": row["trip_id"],
        "item_date": row["item_date"],
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "activity": row["activity"],
        "location_name": row["location_name"],
        "location_map_url": row["location_map_url"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _serialize_accommodation(row: dict[str, Any]) -> dict[str, Any]:
    nights, days = _nights_and_days(row["checkin_date"], row["checkout_date"])
    return {
        "id": row["id"],
        "trip_id": row["trip_id"],
        "name": row["name"],
        "checkin_date": row["checkin_date"],
        "checkout_date": row["checkout_date"],
        "checkin_time": row["checkin_time"],
        "checkout_time": row["checkout_time"],
        "nights": nights,
        "days": days,
        "booking_confirmation": row["booking_confirmation"],
        "instructions": row["instructions"],
        "location_name": row["location_name"],
        "location_map_url": row["location_map_url"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _serialize_trip(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "entry_year": row["entry_year"],
        "entry_month": row["entry_month"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def _serialize_detail(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "trip": _serialize_trip(detail["trip"]),
        "flights": [_serialize_flight(f) for f in detail["flights"]],
        "itinerary": [_serialize_itinerary(i) for i in detail["itinerary"]],
        "accommodations": [_serialize_accommodation(a) for a in detail["accommodations"]],
    }


@router.get("/api/travel")
def travel_list(limit: int = Query(default=500, ge=1, le=2000)) -> dict[str, Any]:
    key = f"travel:list:{limit}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    rows = list_travel_trips(limit=limit)
    result = {"trips": [_serialize_detail(r) for r in rows]}
    cache.set(key, result)
    return result


@router.post("/api/travel")
def travel_create_trip(body: TravelTripCreate) -> dict[str, Any]:
    detail = insert_travel_trip(body.title, body.entry_year, body.entry_month, body.notes)
    return _serialize_detail(detail)


@router.put("/api/travel/{trip_id}")
def travel_update_trip(trip_id: int, body: TravelTripCreate) -> dict[str, Any]:
    detail = update_travel_trip(
        trip_id, body.title, body.entry_year, body.entry_month, body.notes
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return _serialize_detail(detail)


@router.delete("/api/travel/{trip_id}")
def travel_remove_trip(trip_id: int) -> dict[str, Any]:
    if not delete_travel_trip(trip_id):
        raise HTTPException(status_code=404, detail="Trip not found.")
    return {"ok": True}


@router.post("/api/travel/{trip_id}/flights")
def travel_add_flight(trip_id: int, body: TravelFlightCreate) -> dict[str, Any]:
    detail = insert_travel_flight(
        trip_id,
        body.flight_number,
        body.flight_date,
        body.departure_time,
        body.arrival_time,
        body.from_location,
        body.from_map_url,
        body.to_location,
        body.to_map_url,
        body.notes,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return _serialize_detail(detail)


@router.put("/api/travel/{trip_id}/flights/{flight_id}")
def travel_update_flight(
    trip_id: int, flight_id: int, body: TravelFlightCreate
) -> dict[str, Any]:
    detail = update_travel_flight(
        trip_id,
        flight_id,
        body.flight_number,
        body.flight_date,
        body.departure_time,
        body.arrival_time,
        body.from_location,
        body.from_map_url,
        body.to_location,
        body.to_map_url,
        body.notes,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Flight not found.")
    return _serialize_detail(detail)


@router.delete("/api/travel/{trip_id}/flights/{flight_id}")
def travel_remove_flight(trip_id: int, flight_id: int) -> dict[str, Any]:
    detail = delete_travel_flight(trip_id, flight_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Flight not found.")
    return _serialize_detail(detail)


@router.post("/api/travel/{trip_id}/itinerary")
def travel_add_itinerary(trip_id: int, body: TravelItineraryCreate) -> dict[str, Any]:
    detail = insert_travel_itinerary(
        trip_id,
        body.item_date,
        body.start_time,
        body.end_time,
        body.activity,
        body.location_name,
        body.location_map_url,
        body.notes,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return _serialize_detail(detail)


@router.put("/api/travel/{trip_id}/itinerary/{item_id}")
def travel_update_itinerary(
    trip_id: int, item_id: int, body: TravelItineraryCreate
) -> dict[str, Any]:
    detail = update_travel_itinerary(
        trip_id,
        item_id,
        body.item_date,
        body.start_time,
        body.end_time,
        body.activity,
        body.location_name,
        body.location_map_url,
        body.notes,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Itinerary item not found.")
    return _serialize_detail(detail)


@router.delete("/api/travel/{trip_id}/itinerary/{item_id}")
def travel_remove_itinerary(trip_id: int, item_id: int) -> dict[str, Any]:
    detail = delete_travel_itinerary(trip_id, item_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Itinerary item not found.")
    return _serialize_detail(detail)


@router.post("/api/travel/{trip_id}/accommodations")
def travel_add_accommodation(trip_id: int, body: TravelAccommodationCreate) -> dict[str, Any]:
    detail = insert_travel_accommodation(
        trip_id,
        body.name,
        body.checkin_date,
        body.checkout_date,
        body.checkin_time,
        body.checkout_time,
        body.booking_confirmation,
        body.instructions,
        body.location_name,
        body.location_map_url,
        body.notes,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return _serialize_detail(detail)


@router.put("/api/travel/{trip_id}/accommodations/{accommodation_id}")
def travel_update_accommodation(
    trip_id: int, accommodation_id: int, body: TravelAccommodationCreate
) -> dict[str, Any]:
    detail = update_travel_accommodation(
        trip_id,
        accommodation_id,
        body.name,
        body.checkin_date,
        body.checkout_date,
        body.checkin_time,
        body.checkout_time,
        body.booking_confirmation,
        body.instructions,
        body.location_name,
        body.location_map_url,
        body.notes,
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="Accommodation not found.")
    return _serialize_detail(detail)


@router.delete("/api/travel/{trip_id}/accommodations/{accommodation_id}")
def travel_remove_accommodation(trip_id: int, accommodation_id: int) -> dict[str, Any]:
    detail = delete_travel_accommodation(trip_id, accommodation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Accommodation not found.")
    return _serialize_detail(detail)
