"use client";

import { useState } from "react";
import { LocationLink } from "@/components/LocationLink";
import {
  eachDateInRange,
  formatDate,
  formatTimeRange,
  monthKey,
  MONTH_NAMES_FULL,
} from "@/lib/dateFormat";
import { mapsUrlFor } from "@/lib/maps";
import type { TravelAccommodationRow, TravelFlightRow, TravelItineraryRow } from "@/lib/api";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type DayEvents = {
  flights: TravelFlightRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
};

const LEGEND: { label: string; swatch: string }[] = [
  { label: "Flights", swatch: "bg-sky-500" },
  { label: "Itinerary", swatch: "bg-amber-500" },
  { label: "Accommodation", swatch: "bg-emerald-500" },
];

/** Indexes flights/itinerary/accommodations by every "YYYY-MM-DD" they
 * touch — an accommodation counts on every night of its check-in..check-out
 * range, not just its two endpoint dates. */
function buildDayIndex(
  flights: TravelFlightRow[],
  itinerary: TravelItineraryRow[],
  accommodations: TravelAccommodationRow[],
): Map<string, DayEvents> {
  const index = new Map<string, DayEvents>();
  const ensure = (iso: string): DayEvents => {
    let e = index.get(iso);
    if (!e) {
      e = { flights: [], itinerary: [], accommodations: [] };
      index.set(iso, e);
    }
    return e;
  };
  for (const f of flights) {
    if (f.flight_date) ensure(f.flight_date).flights.push(f);
  }
  for (const item of itinerary) {
    ensure(item.item_date).itinerary.push(item);
  }
  for (const a of accommodations) {
    for (const iso of eachDateInRange(a.checkin_date, a.checkout_date)) {
      ensure(iso).accommodations.push(a);
    }
  }
  return index;
}

function DayCell({
  iso,
  day,
  col,
  events,
  selected,
  onClick,
}: {
  iso: string;
  day: number;
  col: number;
  events: DayEvents | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const flightCount = events?.flights.length ?? 0;
  const itineraryCount = events?.itinerary.length ?? 0;
  const accommodations = events?.accommodations ?? [];
  const accCount = accommodations.length;
  const hasAny = flightCount > 0 || itineraryCount > 0 || accCount > 0;

  // A solid bar across every night an accommodation covers — rounded into a
  // capsule at the actual check-in/check-out end, or at a week's edge (so a
  // stay spanning several weeks still reads as one continuous bar row by
  // row); a darker shade flags a night with more than one stay overlapping.
  const accIsStart = accommodations.some((a) => a.checkin_date === iso);
  const accIsEnd = accommodations.some((a) => a.checkout_date === iso);
  const accBg = accCount === 0 ? "" : accCount >= 2 ? "bg-emerald-700" : "bg-emerald-500";
  const accRounding =
    accCount === 0
      ? ""
      : [
          (accIsStart || col === 0) && "rounded-l-full",
          (accIsEnd || col === 6) && "rounded-r-full",
        ]
          .filter(Boolean)
          .join(" ");

  const flightDotColor = flightCount >= 2 ? "bg-sky-700" : "bg-sky-500";
  const itineraryDotColor = itineraryCount >= 2 ? "bg-amber-700" : "bg-amber-500";

  return (
    <button
      type="button"
      onClick={onClick}
      title={
        hasAny
          ? [
              flightCount > 0 && `${flightCount} flight${flightCount === 1 ? "" : "s"}`,
              itineraryCount > 0 && `${itineraryCount} itinerary item${itineraryCount === 1 ? "" : "s"}`,
              accCount > 0 && `${accCount} accommodation${accCount === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(", ")
          : undefined
      }
      className={`relative flex h-14 flex-col items-center justify-center gap-1 sm:h-16 ${accBg} ${accRounding} ${
        selected ? "ring-2 ring-inset ring-indigo-500" : ""
      }`}
    >
      <span
        className={`text-sm font-semibold sm:text-base ${
          accCount > 0
            ? "text-white"
            : hasAny
              ? "text-zinc-900 dark:text-zinc-50"
              : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        {day}
      </span>
      {(flightCount > 0 || itineraryCount > 0) && (
        <div className="flex gap-1">
          {flightCount > 0 && (
            <span className={`h-2 w-2 rounded-full ${flightDotColor}`} aria-hidden />
          )}
          {itineraryCount > 0 && (
            <span className={`h-2 w-2 rounded-full ${itineraryDotColor}`} aria-hidden />
          )}
        </div>
      )}
    </button>
  );
}

function OneMonth({
  year,
  month,
  dayIndex,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  dayIndex: Map<string, DayEvents>;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 text-center text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {MONTH_NAMES_FULL[month - 1]} {year}
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={i}
            className="pb-2 text-center text-xs font-medium text-zinc-400 dark:text-zinc-500"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (day == null) return <div key={i} className="h-14 sm:h-16" />;
          const iso = `${year}-${pad(month)}-${pad(day)}`;
          return (
            <DayCell
              key={i}
              iso={iso}
              day={day}
              col={i % 7}
              events={dayIndex.get(iso)}
              selected={selectedDate === iso}
              onClick={() => onSelectDate(iso)}
            />
          );
        })}
      </div>
    </div>
  );
}

function DetailRow({
  dotClass,
  title,
  subtitle,
  locationName,
  locationUrl,
}: {
  dotClass: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  locationName?: string | null;
  locationUrl?: string | null;
}) {
  return (
    <div className="flex gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <div className="min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-50">
          {title}
          {subtitle && (
            <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">{subtitle}</span>
          )}
        </div>
        {locationName && (
          <div className="mt-0.5">
            <LocationLink name={locationName} url={locationUrl ?? null} />
          </div>
        )}
      </div>
    </div>
  );
}

function DayDetails({
  iso,
  events,
  onClose,
}: {
  iso: string;
  events: DayEvents | undefined;
  onClose: () => void;
}) {
  const flights = events?.flights ?? [];
  const itinerary = events?.itinerary ?? [];
  const accommodations = events?.accommodations ?? [];
  const hasAny = flights.length > 0 || itinerary.length > 0 || accommodations.length > 0;

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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing logged for this day.</p>
      )}
      <div className="flex flex-col gap-3 text-sm">
        {flights.map((f) => (
          <DetailRow
            key={`f-${f.id}`}
            dotClass="bg-sky-500"
            title={`Flight ${f.flight_number}`}
            subtitle={formatTimeRange(f.departure_time, f.arrival_time)}
            locationName={
              f.from_location && f.to_location
                ? `${f.from_location} → ${f.to_location}`
                : f.from_location || f.to_location
            }
            locationUrl={mapsUrlFor(
              f.from_location || f.to_location,
              f.from_location ? f.from_map_url : f.to_map_url,
            )}
          />
        ))}
        {itinerary.map((item) => (
          <DetailRow
            key={`i-${item.id}`}
            dotClass="bg-amber-500"
            title={item.activity}
            subtitle={formatTimeRange(item.start_time, item.end_time)}
            locationName={item.location_name}
            locationUrl={mapsUrlFor(item.location_name, item.location_map_url)}
          />
        ))}
        {accommodations.map((a) => (
          <DetailRow
            key={`a-${a.id}`}
            dotClass="bg-emerald-500"
            title={a.name}
            subtitle={`${formatDate(a.checkin_date)} – ${formatDate(a.checkout_date)} (${a.nights} night${a.nights === 1 ? "" : "s"})`}
            locationName={a.location_name}
            locationUrl={mapsUrlFor(a.location_name, a.location_map_url)}
          />
        ))}
      </div>
    </div>
  );
}

type TripCalendarTrip = { entry_year: number; entry_month: number; entry_month_end: number };

/** A trip's flights/itinerary/accommodations laid out on a calendar — one
 * grid per month actually touched by the trip (its declared span, widened
 * to cover any event date that falls outside it), color-coded by kind.
 * A date with more than one same-kind event gets a darker shade; clicking
 * any date opens a panel below listing what's on it. */
export function TripCalendar({
  trip,
  flights,
  itinerary,
  accommodations,
}: {
  trip: TripCalendarTrip;
  flights: TravelFlightRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const dayIndex = buildDayIndex(flights, itinerary, accommodations);

  const monthKeys = new Set<string>();
  for (const iso of dayIndex.keys()) monthKeys.add(iso.slice(0, 7));
  for (let m = trip.entry_month; m <= trip.entry_month_end; m++) {
    monthKeys.add(monthKey(trip.entry_year, m));
  }
  const months = Array.from(monthKeys)
    .sort()
    .map((k) => {
      const [year, month] = k.split("-").map(Number);
      return { year, month };
    });

  if (months.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${l.swatch}`} />
            {l.label}
          </span>
        ))}
        <span className="text-zinc-400 dark:text-zinc-500">
          (a darker shade means more than one on that day)
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {months.map(({ year, month }) => (
          <OneMonth
            key={`${year}-${month}`}
            year={year}
            month={month}
            dayIndex={dayIndex}
            selectedDate={selectedDate}
            onSelectDate={(iso) => setSelectedDate((cur) => (cur === iso ? null : iso))}
          />
        ))}
      </div>
      {selectedDate && (
        <DayDetails
          iso={selectedDate}
          events={dayIndex.get(selectedDate)}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
