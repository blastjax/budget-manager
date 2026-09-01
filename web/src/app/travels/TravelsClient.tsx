"use client";

import { useCallback, useEffect, useState } from "react";
import { DatePickerField } from "@/components/DatePickerField";
import { DateRangePickerField } from "@/components/DateRangePickerField";
import { FloatingAddButton } from "@/components/FloatingAddButton";
import { LocationLink } from "@/components/LocationLink";
import { Modal } from "@/components/Modal";
import { TimeField } from "@/components/TimeField";
import { TripCalendar } from "@/components/TripCalendar";
import {
  TRAVEL_ADD_BUTTON,
  TRAVEL_CLOSE_BUTTON,
  TRAVEL_DELETE_BUTTON,
  TRAVEL_EDIT_BUTTON,
  TRAVEL_PRIMARY_BUTTON,
  TRAVEL_SECONDARY_BUTTON,
} from "@/app/travels/travelButtonStyles";
import {
  createTravelAccommodation,
  createTravelFlight,
  createTravelItinerary,
  createTravelTrip,
  deleteTravelAccommodation,
  deleteTravelFlight,
  deleteTravelItinerary,
  deleteTravelTrip,
  getTravelTrips,
  updateTravelAccommodation,
  updateTravelFlight,
  updateTravelItinerary,
  updateTravelTrip,
  type TravelAccommodationRow,
  type TravelFlightRow,
  type TravelItineraryRow,
  type TravelTripDetail,
} from "@/lib/api";
import { formatDate, formatTimeLabel, formatTimeRange, MONTH_NAMES_FULL } from "@/lib/dateFormat";
import { mapsUrlFor } from "@/lib/maps";
import { CARD_CLASSES, DASHED_EMPTY_CLASSES, ERROR_ALERT_CLASSES, INPUT_CLASSES } from "@/lib/ui";

const TIME_HELP =
  "Enter time as HH:MM in 24-hour format (e.g. 14:30) — or just digits, e.g. 1430.";

/** Parses free-text "H:MM"/"HH:MM", or plain digits ("1430", "930", "14")
 * as a 24-hour time, zero-padding the result. Blank means "not set"
 * (returns `undefined` so the field is omitted from the request rather
 * than sent as ""). Throws on anything else — an out-of-range hour/minute,
 * "2:30 PM", garbage — same pattern as the app's other free-text fields
 * (e.g. Lotto's draw date). */
function parseOptionalTime24(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let h: number;
  let mi: number;
  const withColon = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (withColon) {
    h = Number(withColon[1]);
    mi = Number(withColon[2]);
  } else {
    const digitsOnly = /^\d{1,4}$/.exec(trimmed);
    if (!digitsOnly) throw new Error(TIME_HELP);
    // 1-2 digits is just the hour ("14" -> 14:00); 3-4 digits splits the
    // last two off as minutes ("1430" -> 14:30, "930" -> 9:30).
    if (trimmed.length <= 2) {
      h = Number(trimmed);
      mi = 0;
    } else {
      h = Number(trimmed.slice(0, -2));
      mi = Number(trimmed.slice(-2));
    }
  }
  if (h < 0 || h > 23 || mi < 0 || mi > 59) throw new Error(TIME_HELP);
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** Live preview while editing an accommodation's dates — the saved
 * nights/days always come from the server (`TravelAccommodationRow.nights`),
 * this is only for immediate feedback in the form. */
function previewNightsDays(checkin: string, checkout: string): { nights: number; days: number } | null {
  if (!checkin || !checkout) return null;
  const ci = new Date(`${checkin}T00:00:00`);
  const co = new Date(`${checkout}T00:00:00`);
  if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime())) return null;
  const nights = Math.max(0, Math.round((co.getTime() - ci.getTime()) / 86_400_000));
  return { nights, days: nights + 1 };
}

function ItemRow({
  children,
  onEdit,
  onDelete,
  saving,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" disabled={saving} className={TRAVEL_EDIT_BUTTON} onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          disabled={saving}
          className={TRAVEL_DELETE_BUTTON}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

type TripFormState = {
  open: boolean;
  editId: number | null;
  title: string;
  entryYear: string;
  entryMonth: string;
  /** Inclusive end month, same year — a trip can span several consecutive
   * months. Defaults equal to `entryMonth` (the single-month case). */
  entryMonthEnd: string;
  notes: string;
};
const emptyTripForm = (): TripFormState => ({
  open: true,
  editId: null,
  title: "",
  entryYear: String(new Date().getFullYear()),
  entryMonth: String(new Date().getMonth() + 1),
  entryMonthEnd: String(new Date().getMonth() + 1),
  notes: "",
});

type FlightFormState = {
  open: boolean;
  tripId: number | null;
  editId: number | null;
  flightNumber: string;
  flightDate: string;
  departureTime: string;
  arrivalTime: string;
  fromLocation: string;
  fromMapUrl: string;
  toLocation: string;
  toMapUrl: string;
  notes: string;
};
const emptyFlightForm = (tripId: number): FlightFormState => ({
  open: true,
  tripId,
  editId: null,
  flightNumber: "",
  flightDate: "",
  departureTime: "",
  arrivalTime: "",
  fromLocation: "",
  fromMapUrl: "",
  toLocation: "",
  toMapUrl: "",
  notes: "",
});

type ItineraryFormState = {
  open: boolean;
  tripId: number | null;
  editId: number | null;
  itemDate: string;
  /** Optional — set only for an item that spans past its start date (an
   * overnight train, a multi-day trek). Blank means a same-day item. */
  itemEndDate: string;
  startTime: string;
  endTime: string;
  activity: string;
  locationName: string;
  locationMapUrl: string;
  notes: string;
};
const emptyItineraryForm = (tripId: number): ItineraryFormState => ({
  open: true,
  tripId,
  editId: null,
  itemDate: "",
  itemEndDate: "",
  startTime: "",
  endTime: "",
  activity: "",
  locationName: "",
  locationMapUrl: "",
  notes: "",
});

type AccommodationFormState = {
  open: boolean;
  tripId: number | null;
  editId: number | null;
  name: string;
  checkinDate: string;
  checkoutDate: string;
  checkinTime: string;
  checkoutTime: string;
  bookingConfirmation: string;
  instructions: string;
  locationName: string;
  locationMapUrl: string;
  notes: string;
};
const emptyAccommodationForm = (tripId: number): AccommodationFormState => ({
  open: true,
  tripId,
  editId: null,
  name: "",
  checkinDate: "",
  checkoutDate: "",
  checkinTime: "",
  checkoutTime: "",
  bookingConfirmation: "",
  instructions: "",
  locationName: "",
  locationMapUrl: "",
  notes: "",
});

const CLOSED_TRIP_MODAL: TripFormState = { ...emptyTripForm(), open: false };
const CLOSED_FLIGHT_MODAL: FlightFormState = { ...emptyFlightForm(0), open: false, tripId: null };
const CLOSED_ITINERARY_MODAL: ItineraryFormState = {
  ...emptyItineraryForm(0),
  open: false,
  tripId: null,
};
const CLOSED_ACCOMMODATION_MODAL: AccommodationFormState = {
  ...emptyAccommodationForm(0),
  open: false,
  tripId: null,
};

/** Blank -> undefined so optional API fields are omitted rather than sent as "". */
function optOrUndefined(s: string): string | undefined {
  const trimmed = s.trim();
  return trimmed ? trimmed : undefined;
}

export default function TravelsClient() {
  const [trips, setTrips] = useState<TravelTripDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());

  const toggleYear = (year: string) => {
    setExpandedYears((s) => {
      const next = new Set(s);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const [tripModal, setTripModal] = useState<TripFormState>(CLOSED_TRIP_MODAL);
  const [tripError, setTripError] = useState<string | null>(null);

  const [flightModal, setFlightModal] = useState<FlightFormState>(CLOSED_FLIGHT_MODAL);
  const [flightError, setFlightError] = useState<string | null>(null);

  const [itineraryModal, setItineraryModal] =
    useState<ItineraryFormState>(CLOSED_ITINERARY_MODAL);
  const [itineraryError, setItineraryError] = useState<string | null>(null);

  const [accommodationModal, setAccommodationModal] =
    useState<AccommodationFormState>(CLOSED_ACCOMMODATION_MODAL);
  const [accommodationError, setAccommodationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getTravelTrips(500);
      setTrips(r.trips);
      const currentYear = String(new Date().getFullYear());
      const years = new Set(r.trips.map((t) => String(t.trip.entry_year)));
      setExpandedYears(years.has(currentYear) ? new Set([currentYear]) : new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trips");
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upsertLocalTrip = (detail: TravelTripDetail) => {
    setTrips((ts) => {
      const i = ts.findIndex((t) => t.trip.id === detail.trip.id);
      const out = i === -1 ? [detail, ...ts] : ts.map((t, idx) => (idx === i ? detail : t));
      return out.sort((a, b) => {
        if (a.trip.entry_year !== b.trip.entry_year) {
          return b.trip.entry_year - a.trip.entry_year;
        }
        if (a.trip.entry_month !== b.trip.entry_month) {
          return b.trip.entry_month - a.trip.entry_month;
        }
        return b.trip.id - a.trip.id;
      });
    });
  };

  // --- Trip ---

  const openAddTrip = () => {
    setTripError(null);
    setTripModal(emptyTripForm());
  };
  const openEditTrip = (detail: TravelTripDetail) => {
    setTripError(null);
    setTripModal({
      open: true,
      editId: detail.trip.id,
      title: detail.trip.title,
      entryYear: String(detail.trip.entry_year),
      entryMonth: String(detail.trip.entry_month),
      entryMonthEnd: String(detail.trip.entry_month_end),
      notes: detail.trip.notes ?? "",
    });
  };
  const closeTripModal = () => {
    setTripModal(CLOSED_TRIP_MODAL);
    setTripError(null);
  };
  const submitTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setTripError(null);
    const title = tripModal.title.trim();
    const entryYear = Number(tripModal.entryYear);
    const entryMonth = Number(tripModal.entryMonth);
    const entryMonthEnd = Number(tripModal.entryMonthEnd);
    if (!title) {
      setTripError("Enter a title.");
      return;
    }
    if (!Number.isInteger(entryYear) || entryYear < 1900 || entryYear > 2999) {
      setTripError("Enter a valid year.");
      return;
    }
    if (entryMonthEnd < entryMonth) {
      setTripError("End month must be on or after the start month.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title,
        entry_year: entryYear,
        entry_month: entryMonth,
        entry_month_end: entryMonthEnd,
        notes: optOrUndefined(tripModal.notes) ?? null,
      };
      const detail =
        tripModal.editId != null
          ? await updateTravelTrip(tripModal.editId, body)
          : await createTravelTrip(body);
      upsertLocalTrip(detail);
      closeTripModal();
    } catch (err) {
      setTripError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const onDeleteTrip = async (tripId: number) => {
    if (!confirm("Delete this trip and everything under it (flights, itinerary, stays)?")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTravelTrip(tripId);
      setTrips((ts) => ts.filter((t) => t.trip.id !== tripId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  // --- Flight ---

  const openAddFlight = (tripId: number, initialDate?: string) => {
    setFlightError(null);
    setFlightModal({ ...emptyFlightForm(tripId), flightDate: initialDate ?? "" });
  };
  const openEditFlight = (tripId: number, f: TravelFlightRow) => {
    setFlightError(null);
    setFlightModal({
      open: true,
      tripId,
      editId: f.id,
      flightNumber: f.flight_number,
      flightDate: f.flight_date ?? "",
      departureTime: f.departure_time ?? "",
      arrivalTime: f.arrival_time ?? "",
      fromLocation: f.from_location ?? "",
      fromMapUrl: f.from_map_url ?? "",
      toLocation: f.to_location ?? "",
      toMapUrl: f.to_map_url ?? "",
      notes: f.notes ?? "",
    });
  };
  const closeFlightModal = () => {
    setFlightModal(CLOSED_FLIGHT_MODAL);
    setFlightError(null);
  };
  const submitFlight = async (e: React.FormEvent) => {
    e.preventDefault();
    setFlightError(null);
    if (flightModal.tripId == null) return;
    const flightNumber = flightModal.flightNumber.trim();
    if (!flightNumber) {
      setFlightError("Enter a flight number.");
      return;
    }
    let departureTime: string | undefined;
    let arrivalTime: string | undefined;
    try {
      departureTime = parseOptionalTime24(flightModal.departureTime);
      arrivalTime = parseOptionalTime24(flightModal.arrivalTime);
    } catch (err) {
      setFlightError(err instanceof Error ? err.message : "Invalid time");
      return;
    }
    setSaving(true);
    try {
      const body = {
        flight_number: flightNumber,
        flight_date: optOrUndefined(flightModal.flightDate) ?? null,
        departure_time: departureTime ?? null,
        arrival_time: arrivalTime ?? null,
        from_location: optOrUndefined(flightModal.fromLocation) ?? null,
        from_map_url: optOrUndefined(flightModal.fromMapUrl) ?? null,
        to_location: optOrUndefined(flightModal.toLocation) ?? null,
        to_map_url: optOrUndefined(flightModal.toMapUrl) ?? null,
        notes: optOrUndefined(flightModal.notes) ?? null,
      };
      const detail =
        flightModal.editId != null
          ? await updateTravelFlight(flightModal.tripId, flightModal.editId, body)
          : await createTravelFlight(flightModal.tripId, body);
      upsertLocalTrip(detail);
      closeFlightModal();
    } catch (err) {
      setFlightError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const onDeleteFlight = async (tripId: number, flightId: number) => {
    if (!confirm("Delete this flight?")) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await deleteTravelFlight(tripId, flightId);
      upsertLocalTrip(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  // --- Itinerary ---

  const openAddItinerary = (tripId: number, initialDate?: string) => {
    setItineraryError(null);
    setItineraryModal({ ...emptyItineraryForm(tripId), itemDate: initialDate ?? "" });
  };
  const openEditItinerary = (tripId: number, item: TravelItineraryRow) => {
    setItineraryError(null);
    setItineraryModal({
      open: true,
      tripId,
      editId: item.id,
      itemDate: item.item_date,
      itemEndDate: item.item_end_date ?? "",
      startTime: item.start_time ?? "",
      endTime: item.end_time ?? "",
      activity: item.activity,
      locationName: item.location_name ?? "",
      locationMapUrl: item.location_map_url ?? "",
      notes: item.notes ?? "",
    });
  };
  const closeItineraryModal = () => {
    setItineraryModal(CLOSED_ITINERARY_MODAL);
    setItineraryError(null);
  };
  const submitItinerary = async (e: React.FormEvent) => {
    e.preventDefault();
    setItineraryError(null);
    if (itineraryModal.tripId == null) return;
    const activity = itineraryModal.activity.trim();
    if (!itineraryModal.itemDate) {
      setItineraryError("Enter a date.");
      return;
    }
    if (!activity) {
      setItineraryError("Enter an activity.");
      return;
    }
    if (itineraryModal.itemEndDate && itineraryModal.itemEndDate < itineraryModal.itemDate) {
      setItineraryError("End date must be on or after the start date.");
      return;
    }
    let startTime: string | undefined;
    let endTime: string | undefined;
    try {
      startTime = parseOptionalTime24(itineraryModal.startTime);
      endTime = parseOptionalTime24(itineraryModal.endTime);
    } catch (err) {
      setItineraryError(err instanceof Error ? err.message : "Invalid time");
      return;
    }
    setSaving(true);
    try {
      const body = {
        item_date: itineraryModal.itemDate,
        item_end_date: optOrUndefined(itineraryModal.itemEndDate) ?? null,
        start_time: startTime ?? null,
        end_time: endTime ?? null,
        activity,
        location_name: optOrUndefined(itineraryModal.locationName) ?? null,
        location_map_url: optOrUndefined(itineraryModal.locationMapUrl) ?? null,
        notes: optOrUndefined(itineraryModal.notes) ?? null,
      };
      const detail =
        itineraryModal.editId != null
          ? await updateTravelItinerary(itineraryModal.tripId, itineraryModal.editId, body)
          : await createTravelItinerary(itineraryModal.tripId, body);
      upsertLocalTrip(detail);
      closeItineraryModal();
    } catch (err) {
      setItineraryError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const onDeleteItinerary = async (tripId: number, itemId: number) => {
    if (!confirm("Delete this itinerary item?")) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await deleteTravelItinerary(tripId, itemId);
      upsertLocalTrip(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  // --- Accommodation ---

  const openAddAccommodation = (tripId: number, initialDate?: string) => {
    setAccommodationError(null);
    setAccommodationModal({
      ...emptyAccommodationForm(tripId),
      checkinDate: initialDate ?? "",
      checkoutDate: initialDate ?? "",
    });
  };
  const openEditAccommodation = (tripId: number, a: TravelAccommodationRow) => {
    setAccommodationError(null);
    setAccommodationModal({
      open: true,
      tripId,
      editId: a.id,
      name: a.name,
      checkinDate: a.checkin_date,
      checkoutDate: a.checkout_date,
      checkinTime: a.checkin_time ?? "",
      checkoutTime: a.checkout_time ?? "",
      bookingConfirmation: a.booking_confirmation ?? "",
      instructions: a.instructions ?? "",
      locationName: a.location_name ?? "",
      locationMapUrl: a.location_map_url ?? "",
      notes: a.notes ?? "",
    });
  };
  const closeAccommodationModal = () => {
    setAccommodationModal(CLOSED_ACCOMMODATION_MODAL);
    setAccommodationError(null);
  };
  const submitAccommodation = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccommodationError(null);
    if (accommodationModal.tripId == null) return;
    const name = accommodationModal.name.trim();
    if (!name) {
      setAccommodationError("Enter a name.");
      return;
    }
    if (!accommodationModal.checkinDate || !accommodationModal.checkoutDate) {
      setAccommodationError("Enter both check-in and check-out dates.");
      return;
    }
    if (accommodationModal.checkoutDate < accommodationModal.checkinDate) {
      setAccommodationError("Check-out date must be on or after check-in date.");
      return;
    }
    let checkinTime: string | undefined;
    let checkoutTime: string | undefined;
    try {
      checkinTime = parseOptionalTime24(accommodationModal.checkinTime);
      checkoutTime = parseOptionalTime24(accommodationModal.checkoutTime);
    } catch (err) {
      setAccommodationError(err instanceof Error ? err.message : "Invalid time");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        checkin_date: accommodationModal.checkinDate,
        checkout_date: accommodationModal.checkoutDate,
        checkin_time: checkinTime ?? null,
        checkout_time: checkoutTime ?? null,
        booking_confirmation: optOrUndefined(accommodationModal.bookingConfirmation) ?? null,
        instructions: optOrUndefined(accommodationModal.instructions) ?? null,
        location_name: optOrUndefined(accommodationModal.locationName) ?? null,
        location_map_url: optOrUndefined(accommodationModal.locationMapUrl) ?? null,
        notes: optOrUndefined(accommodationModal.notes) ?? null,
      };
      const detail =
        accommodationModal.editId != null
          ? await updateTravelAccommodation(
              accommodationModal.tripId,
              accommodationModal.editId,
              body,
            )
          : await createTravelAccommodation(accommodationModal.tripId, body);
      upsertLocalTrip(detail);
      closeAccommodationModal();
    } catch (err) {
      setAccommodationError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const onDeleteAccommodation = async (tripId: number, accommodationId: number) => {
    if (!confirm("Delete this stay?")) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await deleteTravelAccommodation(tripId, accommodationId);
      upsertLocalTrip(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  // `trips` is already sorted year desc, month desc — one pass buckets
  // same-year, same-month runs into nested groups.
  type MonthGroup = { month: number; trips: TravelTripDetail[] };
  type YearGroup = { year: number; months: MonthGroup[] };
  const yearGroups: YearGroup[] = [];
  for (const detail of trips) {
    const { entry_year, entry_month } = detail.trip;
    let yg = yearGroups[yearGroups.length - 1];
    if (!yg || yg.year !== entry_year) {
      yg = { year: entry_year, months: [] };
      yearGroups.push(yg);
    }
    let mg = yg.months[yg.months.length - 1];
    if (!mg || mg.month !== entry_month) {
      mg = { month: entry_month, trips: [] };
      yg.months.push(mg);
    }
    mg.trips.push(detail);
  }

  const renderTripCard = (detail: TravelTripDetail) => {
    const { trip, flights, itinerary, accommodations } = detail;
    return (
      <div
        key={trip.id}
        className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {trip.title}
            </h4>
            {trip.notes && (
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
                {trip.notes}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_EDIT_BUTTON}
              onClick={() => openEditTrip(detail)}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_DELETE_BUTTON}
              onClick={() => void onDeleteTrip(trip.id)}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Calendar */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h5 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Calendar</h5>
          <TripCalendar
            trip={trip}
            flights={flights}
            itinerary={itinerary}
            accommodations={accommodations}
            saving={saving}
            onAddFlight={(date) => openAddFlight(trip.id, date)}
            onEditFlight={(f) => openEditFlight(trip.id, f)}
            onDeleteFlight={(flightId) => void onDeleteFlight(trip.id, flightId)}
            onAddItinerary={(date) => openAddItinerary(trip.id, date)}
            onEditItinerary={(item) => openEditItinerary(trip.id, item)}
            onDeleteItinerary={(itemId) => void onDeleteItinerary(trip.id, itemId)}
            onAddAccommodation={(date) => openAddAccommodation(trip.id, date)}
            onEditAccommodation={(a) => openEditAccommodation(trip.id, a)}
            onDeleteAccommodation={(id) => void onDeleteAccommodation(trip.id, id)}
          />
        </div>

        {/* Flights */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Flights</h5>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_ADD_BUTTON}
              onClick={() => openAddFlight(trip.id)}
            >
              + Add flight
            </button>
          </div>
          {flights.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No flights logged.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {flights.map((f) => {
                const fromUrl = mapsUrlFor(f.from_location, f.from_map_url);
                const toUrl = mapsUrlFor(f.to_location, f.to_map_url);
                const timeRange = formatTimeRange(f.departure_time, f.arrival_time);
                return (
                  <ItemRow
                    key={f.id}
                    saving={saving}
                    onEdit={() => openEditFlight(trip.id, f)}
                    onDelete={() => void onDeleteFlight(trip.id, f.id)}
                  >
                    <div className="font-medium text-zinc-900 dark:text-zinc-50">
                      {f.flight_number}
                      {f.flight_date && (
                        <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                          {formatDate(f.flight_date)}
                        </span>
                      )}
                    </div>
                    {timeRange && (
                      <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">{timeRange}</div>
                    )}
                    {(f.from_location || f.to_location) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <LocationLink name={f.from_location} url={fromUrl} />
                        {f.from_location && f.to_location && (
                          <span className="text-zinc-400" aria-hidden>
                            →
                          </span>
                        )}
                        <LocationLink name={f.to_location} url={toUrl} />
                      </div>
                    )}
                    {f.notes && (
                      <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
                        {f.notes}
                      </div>
                    )}
                  </ItemRow>
                );
              })}
            </ul>
          )}
        </div>

        {/* Itinerary */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Itinerary</h5>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_ADD_BUTTON}
              onClick={() => openAddItinerary(trip.id)}
            >
              + Add item
            </button>
          </div>
          {itinerary.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              No itinerary items yet.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {itinerary.map((item) => {
                const url = mapsUrlFor(item.location_name, item.location_map_url);
                const timeRange = formatTimeRange(item.start_time, item.end_time);
                const spansDays = item.item_end_date && item.item_end_date !== item.item_date;
                return (
                  <ItemRow
                    key={item.id}
                    saving={saving}
                    onEdit={() => openEditItinerary(trip.id, item)}
                    onDelete={() => void onDeleteItinerary(trip.id, item.id)}
                  >
                    <div className="font-medium text-zinc-900 dark:text-zinc-50">
                      {spansDays
                        ? `${formatDate(item.item_date)} – ${formatDate(item.item_end_date)}`
                        : formatDate(item.item_date)}
                      {timeRange && (
                        <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                          {timeRange}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-zinc-700 dark:text-zinc-300">{item.activity}</div>
                    {item.location_name && (
                      <div className="mt-0.5">
                        <LocationLink name={item.location_name} url={url} />
                      </div>
                    )}
                    {item.notes && (
                      <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
                        {item.notes}
                      </div>
                    )}
                  </ItemRow>
                );
              })}
            </ul>
          )}
        </div>

        {/* Accommodations */}
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Accommodations
            </h5>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_ADD_BUTTON}
              onClick={() => openAddAccommodation(trip.id)}
            >
              + Add stay
            </button>
          </div>
          {accommodations.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No stays logged.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {accommodations.map((a) => {
                const url = mapsUrlFor(a.location_name, a.location_map_url);
                return (
                  <ItemRow
                    key={a.id}
                    saving={saving}
                    onEdit={() => openEditAccommodation(trip.id, a)}
                    onDelete={() => void onDeleteAccommodation(trip.id, a.id)}
                  >
                    <div className="font-medium text-zinc-900 dark:text-zinc-50">{a.name}</div>
                    <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                      {formatDate(a.checkin_date)}
                      {a.checkin_time && ` · ${formatTimeLabel(a.checkin_time)}`}
                      {" – "}
                      {formatDate(a.checkout_date)}
                      {a.checkout_time && ` · ${formatTimeLabel(a.checkout_time)}`}
                      <span className="ml-2 rounded-full border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                        {a.nights} night{a.nights === 1 ? "" : "s"} · {a.days} day
                        {a.days === 1 ? "" : "s"}
                      </span>
                    </div>
                    {a.location_name && (
                      <div className="mt-0.5">
                        <LocationLink name={a.location_name} url={url} />
                      </div>
                    )}
                    {a.booking_confirmation && (
                      <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
                        Confirmation: {a.booking_confirmation}
                      </div>
                    )}
                    {a.instructions && (
                      <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
                        {a.instructions}
                      </div>
                    )}
                    {a.notes && (
                      <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
                        {a.notes}
                      </div>
                    )}
                  </ItemRow>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const anyModalOpen =
    tripModal.open || flightModal.open || itineraryModal.open || accommodationModal.open;
  const accommodationPreview = previewNightsDays(
    accommodationModal.checkinDate,
    accommodationModal.checkoutDate,
  );

  return (
    <div className="relative mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 px-4 pb-28 py-8 sm:px-6">
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Travels
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Trips filed by the year and month you took them, each with its flights, day-by-day
          itinerary, and accommodations. Location links open in Google Maps.
        </p>
      </header>

      {error && (
        <div className={ERROR_ALERT_CLASSES} role="alert">
          {error}
        </div>
      )}

      {!loading && trips.length === 0 && (
        <p className={DASHED_EMPTY_CLASSES}>No trips yet — add one to get started.</p>
      )}

      <div className="flex flex-col gap-6">
        {yearGroups.map((yg) => {
          const yearKey = String(yg.year);
          const expanded = expandedYears.has(yearKey);
          const tripCount = yg.months.reduce((n, mg) => n + mg.trips.length, 0);
          return (
            <section key={yearKey} className={CARD_CLASSES}>
              <button
                type="button"
                className="-m-1 flex w-full flex-wrap items-center justify-between gap-3 rounded-lg p-1 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                aria-expanded={expanded}
                onClick={() => toggleYear(yearKey)}
              >
                <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                  {yg.year}
                  <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                    ({tripCount} trip{tripCount === 1 ? "" : "s"})
                  </span>
                </h2>
                <span
                  aria-hidden
                  className={`text-zinc-400 transition-transform dark:text-zinc-500 ${
                    expanded ? "rotate-90" : ""
                  }`}
                >
                  ›
                </span>
              </button>
              {expanded && (
                <div className="mt-4 flex flex-col gap-6">
                  {yg.months.map((mg) => (
                    <div key={mg.month}>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {MONTH_NAMES_FULL[mg.month - 1] ?? mg.month}
                      </h3>
                      <div className="mt-3 flex flex-col gap-4">
                        {mg.trips.map((t) => renderTripCard(t))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Trip modal */}
      <Modal open={tripModal.open} onClose={closeTripModal} ariaLabelledBy="travel-trip-title">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2
            id="travel-trip-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {tripModal.editId != null ? "Edit trip" : "Add trip"}
          </h2>
          <button
            type="button"
            className={TRAVEL_CLOSE_BUTTON}
            onClick={closeTripModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitTrip} className="flex flex-col gap-4">
          {tripError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {tripError}
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Title</span>
            <input
              required
              type="text"
              className={INPUT_CLASSES}
              value={tripModal.title}
              disabled={saving}
              placeholder="e.g. Japan trip"
              onChange={(e) => setTripModal((m) => ({ ...m, title: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Year</span>
              <input
                required
                type="number"
                className={INPUT_CLASSES}
                value={tripModal.entryYear}
                disabled={saving}
                onChange={(e) => setTripModal((m) => ({ ...m, entryYear: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Start month</span>
              <select
                className={INPUT_CLASSES}
                value={tripModal.entryMonth}
                disabled={saving}
                onChange={(e) =>
                  setTripModal((m) => {
                    const entryMonth = e.target.value;
                    // Keep the end month from trailing behind a later start
                    // month — most trips are a single month, so this keeps
                    // that the common case without an extra click.
                    const entryMonthEnd =
                      Number(m.entryMonthEnd) < Number(entryMonth) ? entryMonth : m.entryMonthEnd;
                    return { ...m, entryMonth, entryMonthEnd };
                  })
                }
              >
                {MONTH_NAMES_FULL.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">End month</span>
              <select
                className={INPUT_CLASSES}
                value={tripModal.entryMonthEnd}
                disabled={saving}
                onChange={(e) => setTripModal((m) => ({ ...m, entryMonthEnd: e.target.value }))}
              >
                {MONTH_NAMES_FULL.map((name, i) => (
                  <option
                    key={name}
                    value={i + 1}
                    disabled={i + 1 < Number(tripModal.entryMonth)}
                  >
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            A trip usually files under one month — pick a later end month only if it spans
            several.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Notes <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <textarea
              rows={2}
              className={INPUT_CLASSES}
              value={tripModal.notes}
              disabled={saving}
              onChange={(e) => setTripModal((m) => ({ ...m, notes: e.target.value }))}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={TRAVEL_PRIMARY_BUTTON}>
              {saving ? "Saving…" : tripModal.editId != null ? "Update" : "Add"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_SECONDARY_BUTTON}
              onClick={closeTripModal}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Flight modal */}
      <Modal open={flightModal.open} onClose={closeFlightModal} ariaLabelledBy="travel-flight-title">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2
            id="travel-flight-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {flightModal.editId != null ? "Edit flight" : "Add flight"}
          </h2>
          <button
            type="button"
            className={TRAVEL_CLOSE_BUTTON}
            onClick={closeFlightModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitFlight} className="flex flex-col gap-4">
          {flightError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {flightError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Flight number</span>
              <input
                required
                type="text"
                className={INPUT_CLASSES}
                value={flightModal.flightNumber}
                disabled={saving}
                placeholder="e.g. PR102"
                onChange={(e) =>
                  setFlightModal((m) => ({ ...m, flightNumber: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Date <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <DatePickerField
                value={flightModal.flightDate}
                disabled={saving}
                onChange={(iso) => setFlightModal((m) => ({ ...m, flightDate: iso }))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Departure time (24h) <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <TimeField
                value={flightModal.departureTime}
                disabled={saving}
                onChange={(hhmm) => setFlightModal((m) => ({ ...m, departureTime: hhmm }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Arrival time (24h) <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <TimeField
                value={flightModal.arrivalTime}
                disabled={saving}
                onChange={(hhmm) => setFlightModal((m) => ({ ...m, arrivalTime: hhmm }))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                From <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="text"
                className={INPUT_CLASSES}
                value={flightModal.fromLocation}
                disabled={saving}
                placeholder="e.g. Manila (MNL)"
                onChange={(e) =>
                  setFlightModal((m) => ({ ...m, fromLocation: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                From maps link <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="url"
                className={INPUT_CLASSES}
                value={flightModal.fromMapUrl}
                disabled={saving}
                placeholder="Auto-built from the name if blank"
                onChange={(e) => setFlightModal((m) => ({ ...m, fromMapUrl: e.target.value }))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                To <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="text"
                className={INPUT_CLASSES}
                value={flightModal.toLocation}
                disabled={saving}
                placeholder="e.g. Tokyo (NRT)"
                onChange={(e) => setFlightModal((m) => ({ ...m, toLocation: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                To maps link <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="url"
                className={INPUT_CLASSES}
                value={flightModal.toMapUrl}
                disabled={saving}
                placeholder="Auto-built from the name if blank"
                onChange={(e) => setFlightModal((m) => ({ ...m, toMapUrl: e.target.value }))}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Notes <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <textarea
              rows={2}
              className={INPUT_CLASSES}
              value={flightModal.notes}
              disabled={saving}
              onChange={(e) => setFlightModal((m) => ({ ...m, notes: e.target.value }))}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={TRAVEL_PRIMARY_BUTTON}>
              {saving ? "Saving…" : flightModal.editId != null ? "Update" : "Add"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_SECONDARY_BUTTON}
              onClick={closeFlightModal}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Itinerary modal */}
      <Modal
        open={itineraryModal.open}
        onClose={closeItineraryModal}
        ariaLabelledBy="travel-itinerary-title"
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2
            id="travel-itinerary-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {itineraryModal.editId != null ? "Edit itinerary item" : "Add itinerary item"}
          </h2>
          <button
            type="button"
            className={TRAVEL_CLOSE_BUTTON}
            onClick={closeItineraryModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitItinerary} className="flex flex-col gap-4">
          {itineraryError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {itineraryError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Date</span>
              <DatePickerField
                value={itineraryModal.itemDate}
                disabled={saving}
                onChange={(iso) =>
                  setItineraryModal((m) => ({
                    ...m,
                    itemDate: iso,
                    // Keep a set end date from trailing behind a later start
                    // date, same as the trip's start/end month fields.
                    itemEndDate: m.itemEndDate && m.itemEndDate < iso ? iso : m.itemEndDate,
                  }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                End date <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <DatePickerField
                value={itineraryModal.itemEndDate}
                disabled={saving}
                placeholder="Same day"
                onChange={(iso) => setItineraryModal((m) => ({ ...m, itemEndDate: iso }))}
              />
            </label>
          </div>
          <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Only needed when the item spans past its start date — an overnight train, a
            multi-day trek.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Start time (24h) <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <TimeField
                value={itineraryModal.startTime}
                disabled={saving}
                onChange={(hhmm) => setItineraryModal((m) => ({ ...m, startTime: hhmm }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                End time (24h) <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <TimeField
                value={itineraryModal.endTime}
                disabled={saving}
                onChange={(hhmm) => setItineraryModal((m) => ({ ...m, endTime: hhmm }))}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Activity</span>
            <input
              required
              type="text"
              className={INPUT_CLASSES}
              value={itineraryModal.activity}
              disabled={saving}
              placeholder="e.g. Visit Senso-ji Temple"
              onChange={(e) => setItineraryModal((m) => ({ ...m, activity: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Location <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="text"
                className={INPUT_CLASSES}
                value={itineraryModal.locationName}
                disabled={saving}
                onChange={(e) =>
                  setItineraryModal((m) => ({ ...m, locationName: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Maps link <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="url"
                className={INPUT_CLASSES}
                value={itineraryModal.locationMapUrl}
                disabled={saving}
                placeholder="Auto-built from the name if blank"
                onChange={(e) =>
                  setItineraryModal((m) => ({ ...m, locationMapUrl: e.target.value }))
                }
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Notes <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <textarea
              rows={2}
              className={INPUT_CLASSES}
              value={itineraryModal.notes}
              disabled={saving}
              onChange={(e) => setItineraryModal((m) => ({ ...m, notes: e.target.value }))}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={TRAVEL_PRIMARY_BUTTON}>
              {saving ? "Saving…" : itineraryModal.editId != null ? "Update" : "Add"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_SECONDARY_BUTTON}
              onClick={closeItineraryModal}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* Accommodation modal */}
      <Modal
        open={accommodationModal.open}
        onClose={closeAccommodationModal}
        ariaLabelledBy="travel-accommodation-title"
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2
            id="travel-accommodation-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {accommodationModal.editId != null ? "Edit stay" : "Add stay"}
          </h2>
          <button
            type="button"
            className={TRAVEL_CLOSE_BUTTON}
            onClick={closeAccommodationModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitAccommodation} className="flex flex-col gap-4">
          {accommodationError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {accommodationError}
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Name</span>
            <input
              required
              type="text"
              className={INPUT_CLASSES}
              value={accommodationModal.name}
              disabled={saving}
              placeholder="e.g. Park Hotel Tokyo"
              onChange={(e) => setAccommodationModal((m) => ({ ...m, name: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Check-in / check-out dates</span>
            <DateRangePickerField
              startValue={accommodationModal.checkinDate}
              endValue={accommodationModal.checkoutDate}
              disabled={saving}
              placeholder="Select check-in and check-out dates"
              onChange={(start, end) =>
                setAccommodationModal((m) => ({ ...m, checkinDate: start, checkoutDate: end }))
              }
            />
          </label>
          {accommodationPreview && (
            <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {accommodationPreview.nights} night{accommodationPreview.nights === 1 ? "" : "s"} ·{" "}
              {accommodationPreview.days} day{accommodationPreview.days === 1 ? "" : "s"}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Check-in time (24h) <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <TimeField
                value={accommodationModal.checkinTime}
                disabled={saving}
                onChange={(hhmm) => setAccommodationModal((m) => ({ ...m, checkinTime: hhmm }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Check-out time (24h) <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <TimeField
                value={accommodationModal.checkoutTime}
                disabled={saving}
                onChange={(hhmm) => setAccommodationModal((m) => ({ ...m, checkoutTime: hhmm }))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Location <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="text"
                className={INPUT_CLASSES}
                value={accommodationModal.locationName}
                disabled={saving}
                onChange={(e) =>
                  setAccommodationModal((m) => ({ ...m, locationName: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Maps link <span className="font-normal text-zinc-400">(optional)</span>
              </span>
              <input
                type="url"
                className={INPUT_CLASSES}
                value={accommodationModal.locationMapUrl}
                disabled={saving}
                placeholder="Auto-built from the name if blank"
                onChange={(e) =>
                  setAccommodationModal((m) => ({ ...m, locationMapUrl: e.target.value }))
                }
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Booking confirmation <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <input
              type="text"
              className={INPUT_CLASSES}
              value={accommodationModal.bookingConfirmation}
              disabled={saving}
              onChange={(e) =>
                setAccommodationModal((m) => ({ ...m, bookingConfirmation: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Instructions <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <textarea
              rows={2}
              className={INPUT_CLASSES}
              value={accommodationModal.instructions}
              disabled={saving}
              placeholder="e.g. Ring the bell at the side entrance"
              onChange={(e) =>
                setAccommodationModal((m) => ({ ...m, instructions: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Notes <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <textarea
              rows={2}
              className={INPUT_CLASSES}
              value={accommodationModal.notes}
              disabled={saving}
              onChange={(e) => setAccommodationModal((m) => ({ ...m, notes: e.target.value }))}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={TRAVEL_PRIMARY_BUTTON}>
              {saving ? "Saving…" : accommodationModal.editId != null ? "Update" : "Add"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={TRAVEL_SECONDARY_BUTTON}
              onClick={closeAccommodationModal}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <FloatingAddButton hidden={anyModalOpen} onClick={openAddTrip} ariaLabel="Add trip" />
    </div>
  );
}
