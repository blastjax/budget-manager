"use client";

import { useState } from "react";
import { LocationLink } from "@/components/LocationLink";
import { Modal } from "@/components/Modal";
import {
  addMonths,
  formatDate,
  formatMonthYear,
  formatTimeRange,
  toIsoDateLocal,
} from "@/lib/dateFormat";
import { mapsUrlFor } from "@/lib/maps";
import { SECONDARY_BUTTON_CLASSES } from "@/lib/ui";
import type { TravelAccommodationRow, TravelFlightRow, TravelItineraryRow } from "@/lib/api";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_PILLS = 2;

const FLIGHT_PILL_CLASSES = "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200";
const ITINERARY_PILL_CLASSES = "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200";
const ACCOMMODATION_BANNER_CLASSES =
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "Flight: MNL to NRT" when both ends are known, degrading gracefully
 * down to the bare flight number when neither location is set. */
function flightLabel(f: TravelFlightRow): string {
  if (f.from_location && f.to_location) return `Flight: ${f.from_location} to ${f.to_location}`;
  if (f.from_location || f.to_location) return `Flight: ${f.from_location ?? f.to_location}`;
  return `Flight ${f.flight_number}`;
}

function accommodationLabel(a: TravelAccommodationRow): string {
  return `Stay at ${a.name}`;
}

type WeekDay = { iso: string; day: number; inMonth: boolean };

/** The 7-day weeks covering `year`/`month`, padded with the trailing days
 * of the previous month and the leading days of the next so every week is
 * a full row (those padding days are shown dimmed, out of month). */
function buildWeeks(year: number, month: number): WeekDay[][] {
  const startOffset = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDaysInMonth = new Date(year, month - 1, 0).getDate();
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);

  const cells: WeekDay[] = [];
  for (let i = 0; i < startOffset; i++) {
    const day = prevDaysInMonth - startOffset + 1 + i;
    cells.push({ iso: `${prev.y}-${pad(prev.m)}-${pad(day)}`, day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: `${year}-${pad(month)}-${pad(day)}`, day, inMonth: true });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ iso: `${next.y}-${pad(next.m)}-${pad(nextDay)}`, day: nextDay, inMonth: false });
    nextDay++;
  }
  const weeks: WeekDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

type BannerSegment = { key: string; label: string; startCol: number; endCol: number; lane: number };

/** The accommodation banners touching this week, clamped to its 7 columns
 * and greedily packed into lanes so overlapping stays stack instead of
 * colliding (each lane is its own row above the day cells). */
function bannersForWeek(week: WeekDay[], accommodations: TravelAccommodationRow[]): BannerSegment[] {
  const weekStart = week[0].iso;
  const weekEnd = week[6].iso;
  const raw = accommodations
    .filter((a) => a.checkout_date >= weekStart && a.checkin_date <= weekEnd)
    .map((a) => {
      const clampedStart = a.checkin_date > weekStart ? a.checkin_date : weekStart;
      const clampedEnd = a.checkout_date < weekEnd ? a.checkout_date : weekEnd;
      return {
        key: `a-${a.id}-${weekStart}`,
        label: accommodationLabel(a),
        startCol: week.findIndex((d) => d.iso === clampedStart),
        endCol: week.findIndex((d) => d.iso === clampedEnd),
      };
    })
    .sort((a, b) => a.startCol - b.startCol);

  const laneEndCols: number[] = [];
  return raw.map((seg) => {
    let lane = laneEndCols.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(seg.endCol);
    } else {
      laneEndCols[lane] = seg.endCol;
    }
    return { ...seg, lane };
  });
}

type DayPill = { key: string; label: string; classes: string; sortKey: string };

function pillsForDay(
  iso: string,
  flights: TravelFlightRow[],
  itinerary: TravelItineraryRow[],
): DayPill[] {
  const pills: DayPill[] = [];
  for (const f of flights) {
    if (f.flight_date !== iso) continue;
    pills.push({
      key: `f-${f.id}`,
      label: flightLabel(f),
      classes: FLIGHT_PILL_CLASSES,
      sortKey: f.departure_time ?? "",
    });
  }
  for (const item of itinerary) {
    if (item.item_date !== iso) continue;
    pills.push({
      key: `i-${item.id}`,
      label: item.activity,
      classes: ITINERARY_PILL_CLASSES,
      sortKey: item.start_time ?? "",
    });
  }
  return pills.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function DetailRow({
  dotClass,
  title,
  subtitle,
  locationName,
  locationUrl,
  onEdit,
  onDelete,
  saving,
}: {
  dotClass: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  locationName?: string | null;
  locationUrl?: string | null;
  onEdit: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 gap-2.5">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <div className="min-w-0">
          <div className="font-medium text-zinc-900 dark:text-zinc-50">
            {title}
            {subtitle && (
              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </span>
            )}
          </div>
          {locationName && (
            <div className="mt-0.5">
              <LocationLink name={locationName} url={locationUrl ?? null} />
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={onEdit}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onDelete}
          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 transition-colors duration-150 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

type CalendarActions = {
  onAddFlight: (date?: string) => void;
  onEditFlight: (flight: TravelFlightRow) => void;
  onDeleteFlight: (flightId: number) => void;
  onAddItinerary: (date?: string) => void;
  onEditItinerary: (item: TravelItineraryRow) => void;
  onDeleteItinerary: (itemId: number) => void;
  onAddAccommodation: (date?: string) => void;
  onEditAccommodation: (accommodation: TravelAccommodationRow) => void;
  onDeleteAccommodation: (accommodationId: number) => void;
  saving: boolean;
};

function DayDetails({
  iso,
  flights,
  itinerary,
  accommodations,
  actions,
  onClose,
}: {
  iso: string;
  flights: TravelFlightRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  actions: CalendarActions;
  onClose: () => void;
}) {
  const dayFlights = flights.filter((f) => f.flight_date === iso);
  const dayItinerary = itinerary.filter((item) => item.item_date === iso);
  const dayAccommodations = accommodations.filter(
    (a) => a.checkin_date <= iso && iso <= a.checkout_date,
  );
  const hasAny = dayFlights.length > 0 || dayItinerary.length > 0 || dayAccommodations.length > 0;

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {formatDate(iso)}
        </h6>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
        >
          Close
        </button>
      </div>
      {!hasAny && (
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          Nothing logged for this day.
        </p>
      )}
      <div className="flex flex-col gap-3 text-sm">
        {dayFlights.map((f) => (
          <DetailRow
            key={`f-${f.id}`}
            dotClass="bg-sky-500"
            title={flightLabel(f)}
            subtitle={formatTimeRange(f.departure_time, f.arrival_time)}
            saving={actions.saving}
            onEdit={() => actions.onEditFlight(f)}
            onDelete={() => actions.onDeleteFlight(f.id)}
          />
        ))}
        {dayItinerary.map((item) => (
          <DetailRow
            key={`i-${item.id}`}
            dotClass="bg-amber-500"
            title={item.activity}
            subtitle={formatTimeRange(item.start_time, item.end_time)}
            locationName={item.location_name}
            locationUrl={mapsUrlFor(item.location_name, item.location_map_url)}
            saving={actions.saving}
            onEdit={() => actions.onEditItinerary(item)}
            onDelete={() => actions.onDeleteItinerary(item.id)}
          />
        ))}
        {dayAccommodations.map((a) => (
          <DetailRow
            key={`a-${a.id}`}
            dotClass="bg-emerald-500"
            title={accommodationLabel(a)}
            subtitle={`${formatDate(a.checkin_date)} – ${formatDate(a.checkout_date)} (${a.nights} night${a.nights === 1 ? "" : "s"})`}
            locationName={a.location_name}
            locationUrl={mapsUrlFor(a.location_name, a.location_map_url)}
            saving={actions.saving}
            onEdit={() => actions.onEditAccommodation(a)}
            onDelete={() => actions.onDeleteAccommodation(a.id)}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button
          type="button"
          disabled={actions.saving}
          onClick={() => actions.onAddFlight(iso)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          + Add flight
        </button>
        <button
          type="button"
          disabled={actions.saving}
          onClick={() => actions.onAddItinerary(iso)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          + Add itinerary item
        </button>
        <button
          type="button"
          disabled={actions.saving}
          onClick={() => actions.onAddAccommodation(iso)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          + Add stay
        </button>
      </div>
    </div>
  );
}

function WeekRow({
  week,
  todayIso,
  flights,
  itinerary,
  accommodations,
  selectedDate,
  onSelectDate,
}: {
  week: WeekDay[];
  todayIso: string;
  flights: TravelFlightRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}) {
  const banners = bannersForWeek(week, accommodations);
  const laneCount = banners.reduce((max, b) => Math.max(max, b.lane + 1), 0);

  return (
    <div className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
      <div className="grid grid-cols-7">
        {week.map((d) => (
          <div key={d.iso} className="px-2 pt-2">
            <button
              type="button"
              onClick={() => onSelectDate(d.iso)}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm transition-colors duration-150 ${
                d.iso === todayIso
                  ? "bg-indigo-600 font-semibold text-white"
                  : selectedDate === d.iso
                    ? "bg-zinc-200 font-semibold text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
                    : d.inMonth
                      ? "font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                      : "text-zinc-300 hover:bg-zinc-100 dark:text-zinc-600 dark:hover:bg-zinc-800/60"
              }`}
            >
              {d.day}
            </button>
          </div>
        ))}
      </div>

      {laneCount > 0 && (
        <div
          className="grid grid-cols-7 gap-1 px-2 pt-1"
          style={{ gridTemplateRows: `repeat(${laneCount}, minmax(0, auto))` }}
        >
          {banners.map((b) => (
            <button
              key={b.key}
              type="button"
              title={b.label}
              onClick={() => onSelectDate(week[b.startCol].iso)}
              style={{ gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`, gridRow: b.lane + 1 }}
              className={`truncate rounded-md px-2 py-1 text-left text-xs font-semibold transition-opacity duration-150 hover:opacity-80 ${ACCOMMODATION_BANNER_CLASSES}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 px-2 pb-2 pt-1">
        {week.map((d) => {
          const pills = pillsForDay(d.iso, flights, itinerary);
          const visible = pills.slice(0, MAX_VISIBLE_PILLS);
          const overflow = pills.length - visible.length;
          return (
            <div key={d.iso} className="flex min-h-6 flex-col gap-1">
              {visible.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.label}
                  onClick={() => onSelectDate(d.iso)}
                  className={`truncate rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-opacity duration-150 hover:opacity-80 ${p.classes}`}
                >
                  {p.label}
                </button>
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectDate(d.iso)}
                  className="text-left text-[11px] font-medium text-zinc-500 transition-colors duration-150 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  +{overflow} More
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TripCalendarTrip = { title: string; entry_year: number; entry_month: number };

function FullScreenCalendar({
  trip,
  flights,
  itinerary,
  accommodations,
  actions,
  onClose,
}: {
  trip: TripCalendarTrip;
  flights: TravelFlightRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  actions: CalendarActions;
  onClose: () => void;
}) {
  const [viewYear, setViewYear] = useState(trip.entry_year);
  const [viewMonth, setViewMonth] = useState(trip.entry_month);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = toIsoDateLocal(new Date());
  const weeks = buildWeeks(viewYear, viewMonth);

  const goToMonth = (delta: number) => {
    const n = addMonths(viewYear, viewMonth, delta);
    setViewYear(n.y);
    setViewMonth(n.m);
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={`${trip.title} calendar`}
      backdropClassName="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm"
      dialogClassName="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-white p-0 dark:bg-zinc-950"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-6">
        <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {trip.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => goToMonth(-1)}
              className="flex h-8 w-8 items-center justify-center text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
            >
              ‹
            </button>
            <span className="min-w-[9rem] px-1 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {formatMonthYear(viewYear, viewMonth)}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => goToMonth(1)}
              className="flex h-8 w-8 items-center justify-center text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASSES} px-3 py-1.5 text-sm`}
            onClick={() => {
              const now = new Date();
              setViewYear(now.getFullYear());
              setViewMonth(now.getMonth() + 1);
            }}
          >
            Today
          </button>
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASSES} px-3 py-1.5 text-sm`}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800 sm:px-6">
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-500" /> Flights
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Itinerary
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Accommodation
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddFlight(selectedDate ?? undefined)}
            className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1 text-xs`}
          >
            + Add flight
          </button>
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddItinerary(selectedDate ?? undefined)}
            className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1 text-xs`}
          >
            + Add itinerary item
          </button>
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddAccommodation(selectedDate ?? undefined)}
            className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1 text-xs`}
          >
            + Add stay
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-7 border-b border-zinc-200 pb-2 dark:border-zinc-800">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                className="text-center text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              >
                {w}
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            {weeks.map((week) => (
              <WeekRow
                key={week[0].iso}
                week={week}
                todayIso={today}
                flights={flights}
                itinerary={itinerary}
                accommodations={accommodations}
                selectedDate={selectedDate}
                onSelectDate={(iso) => setSelectedDate((cur) => (cur === iso ? null : iso))}
              />
            ))}
          </div>

          {selectedDate && (
            <DayDetails
              iso={selectedDate}
              flights={flights}
              itinerary={itinerary}
              accommodations={accommodations}
              actions={actions}
              onClose={() => setSelectedDate(null)}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export type { CalendarActions as TripCalendarActions };

/** Entry point rendered inline on a trip card: a summary + button that
 * opens the trip's flights/itinerary/accommodations as a full-screen,
 * banner-style month calendar (multi-day stays span as bars across the
 * days they cover; flights and itinerary items are pills on their day).
 * Clicking a pill/banner (or any date) shows that day's agenda below the
 * grid, with edit/delete on each item and add buttons for new ones — the
 * same create/update/delete flow as the trip card's own list sections,
 * just reachable from inside the calendar too. */
export function TripCalendar({
  trip,
  flights,
  itinerary,
  accommodations,
  ...actions
}: {
  trip: TripCalendarTrip;
  flights: TravelFlightRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
} & CalendarActions) {
  const [open, setOpen] = useState(false);
  const total = flights.length + itinerary.length + accommodations.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {total === 0
          ? "Nothing logged yet."
          : `${flights.length} flight${flights.length === 1 ? "" : "s"} · ${itinerary.length} itinerary item${itinerary.length === 1 ? "" : "s"} · ${accommodations.length} stay${accommodations.length === 1 ? "" : "s"}`}
      </p>
      <button
        type="button"
        className={`${SECONDARY_BUTTON_CLASSES} px-3 py-1.5 text-sm`}
        onClick={() => setOpen(true)}
      >
        Open full calendar
      </button>
      {open && (
        <FullScreenCalendar
          trip={trip}
          flights={flights}
          itinerary={itinerary}
          accommodations={accommodations}
          actions={actions}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
