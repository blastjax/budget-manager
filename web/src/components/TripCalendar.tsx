"use client";

import { MONTH_NAMES_FULL } from "@/lib/dateFormat";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export type TripCalendarMonth = { year: number; month: number };

export type TripCalendarMarks = {
  flights: Set<string>;
  itinerary: Set<string>;
  accommodations: Set<string>;
};

const LEGEND: { key: keyof TripCalendarMarks; label: string; dot: string }[] = [
  { key: "flights", label: "Flights", dot: "bg-sky-500" },
  { key: "itinerary", label: "Itinerary", dot: "bg-amber-500" },
  { key: "accommodations", label: "Accommodation", dot: "bg-emerald-500" },
];

function OneMonth({
  year,
  month,
  marks,
}: {
  year: number;
  month: number;
  marks: TripCalendarMarks;
}) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {MONTH_NAMES_FULL[month - 1]} {year}
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={i}
            className="pb-1 text-center text-[10px] font-medium text-zinc-400 dark:text-zinc-500"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (day == null) return <div key={i} className="h-9" />;
          const iso = `${year}-${pad(month)}-${pad(day)}`;
          const hasFlight = marks.flights.has(iso);
          const hasItinerary = marks.itinerary.has(iso);
          const hasAccommodation = marks.accommodations.has(iso);
          const any = hasFlight || hasItinerary || hasAccommodation;
          return (
            <div key={i} className="flex flex-col items-center justify-center gap-0.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  any
                    ? "font-semibold text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {day}
              </span>
              <div className="flex h-1.5 gap-0.5">
                {hasFlight && (
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" title="Flight" />
                )}
                {hasItinerary && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Itinerary" />
                )}
                {hasAccommodation && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                    title="Accommodation"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A trip's flights/itinerary/accommodations laid out on a calendar — one
 * grid per month actually touched by the trip (its declared span, widened
 * to cover any event date that falls outside it), color-coded by kind. */
export function TripCalendar({
  months,
  marks,
}: {
  months: TripCalendarMonth[];
  marks: TripCalendarMarks;
}) {
  if (months.length === 0) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {LEGEND.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${l.dot}`} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {months.map(({ year, month }) => (
          <OneMonth key={`${year}-${month}`} year={year} month={month} marks={marks} />
        ))}
      </div>
    </div>
  );
}
