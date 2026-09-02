"use client";

import { useState } from "react";
import { LocationLink } from "@/components/LocationLink";
import { Modal } from "@/components/Modal";
import {
  ACTION_BUTTON_CLASSES,
  ADD_BUTTON_CLASSES,
  CLOSE_BUTTON_CLASSES,
  DELETE_BUTTON_CLASSES,
  EDIT_BUTTON_CLASSES,
  ICON_BUTTON_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  TOGGLE_ACTIVE_BUTTON_CLASSES,
  TOGGLE_INACTIVE_BUTTON_CLASSES,
} from "@/lib/ui";
import {
  addMonths,
  formatDate,
  formatMonthYear,
  formatTimeLabel,
  formatTimeRange,
  toIsoDateLocal,
} from "@/lib/dateFormat";
import { mapsUrlFor } from "@/lib/maps";
import type {
  TravelAccommodationRow,
  TravelFlightRow,
  TravelItineraryRow,
  TravelTransportRow,
} from "@/lib/api";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_PILLS = 2;

const FLIGHT_PILL_CLASSES = "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200";
const TRANSPORT_PILL_CLASSES =
  "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200";
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

/** "Train: Tokyo Station to Kyoto Station" when both ends are known,
 * degrading down to "Bus 45" or the bare mode when there's less to show. */
function transportLabel(t: TravelTransportRow): string {
  const mode = t.mode === "bus" ? "Bus" : "Train";
  if (t.from_location && t.to_location) return `${mode}: ${t.from_location} to ${t.to_location}`;
  if (t.from_location || t.to_location) return `${mode}: ${t.from_location ?? t.to_location}`;
  return t.number ? `${mode} ${t.number}` : mode;
}

function accommodationLabel(a: TravelAccommodationRow): string {
  return `Stay at ${a.name}`;
}

/** "Aug 10 · 15:00 – Aug 15 · 11:00 (5 nights)" — check-in/check-out dates
 * with their times folded in when set, same as the plain list on the trip
 * card (this used to drop the times in the calendar's detail panels). */
function accommodationDetailSubtitle(a: TravelAccommodationRow): string {
  const checkin = formatDate(a.checkin_date) + (a.checkin_time ? ` · ${formatTimeLabel(a.checkin_time)}` : "");
  const checkout = formatDate(a.checkout_date) + (a.checkout_time ? ` · ${formatTimeLabel(a.checkout_time)}` : "");
  return `${checkin} – ${checkout} (${a.nights} night${a.nights === 1 ? "" : "s"})`;
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

/** True for an itinerary item that actually spans past its start date (an
 * overnight train, a multi-day trek) — as opposed to a same-day item with
 * `item_end_date` unset or equal to `item_date`. */
function itinerarySpans(item: TravelItineraryRow): boolean {
  return !!item.item_end_date && item.item_end_date !== item.item_date;
}

/** "Aug 10 – Aug 11 · 22:00 – 06:00" for a spanning item, otherwise just
 * the time range (and the date too, when `alwaysShowDate` — the "whole
 * trip" list isn't already headed by that date the way a day panel is). */
function itineraryDetailSubtitle(item: TravelItineraryRow, alwaysShowDate: boolean): string | undefined {
  const dateText = itinerarySpans(item)
    ? `${formatDate(item.item_date)} – ${formatDate(item.item_end_date)}`
    : alwaysShowDate
      ? formatDate(item.item_date)
      : null;
  return [dateText, formatTimeRange(item.start_time, item.end_time)].filter(Boolean).join(" · ") || undefined;
}

type SpanItem = { key: string; label: string; startDate: string; endDate: string; colorClasses: string };

/** Multi-day accommodations and itinerary items combined into one list of
 * spans, for the calendar's banner lanes. */
function spanItemsFor(
  itinerary: TravelItineraryRow[],
  accommodations: TravelAccommodationRow[],
): SpanItem[] {
  const items: SpanItem[] = [];
  for (const item of itinerary) {
    if (!itinerarySpans(item)) continue;
    items.push({
      key: `i-${item.id}`,
      label: item.activity,
      startDate: item.item_date,
      endDate: item.item_end_date as string,
      colorClasses: ITINERARY_PILL_CLASSES,
    });
  }
  for (const a of accommodations) {
    items.push({
      key: `a-${a.id}`,
      label: accommodationLabel(a),
      startDate: a.checkin_date,
      endDate: a.checkout_date,
      colorClasses: ACCOMMODATION_BANNER_CLASSES,
    });
  }
  return items;
}

type BannerSegment = {
  key: string;
  label: string;
  colorClasses: string;
  startCol: number;
  endCol: number;
  lane: number;
};

/** The spans touching this week (accommodations and multi-day itinerary
 * items alike), clamped to its 7 columns and greedily packed into lanes so
 * overlapping ones stack instead of colliding (each lane is its own row
 * above the day cells). */
function bannersForWeek(week: WeekDay[], items: SpanItem[]): BannerSegment[] {
  const weekStart = week[0].iso;
  const weekEnd = week[6].iso;
  const raw = items
    .filter((it) => it.endDate >= weekStart && it.startDate <= weekEnd)
    .map((it) => {
      const clampedStart = it.startDate > weekStart ? it.startDate : weekStart;
      const clampedEnd = it.endDate < weekEnd ? it.endDate : weekEnd;
      return {
        key: `${it.key}-${weekStart}`,
        label: it.label,
        colorClasses: it.colorClasses,
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
  transport: TravelTransportRow[],
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
  for (const t of transport) {
    if (t.travel_date !== iso) continue;
    pills.push({
      key: `t-${t.id}`,
      label: transportLabel(t),
      classes: TRANSPORT_PILL_CLASSES,
      sortKey: t.departure_time ?? "",
    });
  }
  for (const item of itinerary) {
    if (item.item_date !== iso) continue;
    if (itinerarySpans(item)) continue; // rendered as a banner instead
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
  bookingConfirmation,
  instructions,
  notes,
  onEdit,
  onDelete,
  saving,
}: {
  dotClass: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  locationName?: string | null;
  locationUrl?: string | null;
  bookingConfirmation?: string | null;
  instructions?: string | null;
  notes?: string | null;
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
          {bookingConfirmation && (
            <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
              Confirmation: {bookingConfirmation}
            </div>
          )}
          {instructions && (
            <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
              {instructions}
            </div>
          )}
          {notes && (
            <div className="mt-0.5 whitespace-pre-line text-zinc-500 dark:text-zinc-400">
              {notes}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" disabled={saving} onClick={onEdit} className={EDIT_BUTTON_CLASSES}>
          Edit
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onDelete}
          className={DELETE_BUTTON_CLASSES}
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
  onAddTransport: (date?: string) => void;
  onEditTransport: (transport: TravelTransportRow) => void;
  onDeleteTransport: (transportId: number) => void;
  onAddItinerary: (date?: string) => void;
  onEditItinerary: (item: TravelItineraryRow) => void;
  onDeleteItinerary: (itemId: number) => void;
  onAddAccommodation: (date?: string) => void;
  onEditAccommodation: (accommodation: TravelAccommodationRow) => void;
  onDeleteAccommodation: (accommodationId: number) => void;
  saving: boolean;
};

type EventCategory = "flight" | "transport" | "itinerary" | "accommodation";

const CATEGORY_LABELS: Record<EventCategory, { legend: string; heading: string }> = {
  flight: { legend: "Flights", heading: "All flights" },
  transport: { legend: "Bus/Train", heading: "All bus/train legs" },
  itinerary: { legend: "Itinerary", heading: "All itinerary items" },
  accommodation: { legend: "Accommodation", heading: "All accommodations" },
};

/** The legend doubles as a filter — clicking a swatch shows every item of
 * that kind in the details panel below the calendar, same as "Show whole
 * trip" but narrowed to one category. `activeClasses` reuses each kind's
 * own pill/banner tint so the active swatch reads as "this color". */
const LEGEND_ITEMS: { category: EventCategory; dot: string; activeClasses: string }[] = [
  { category: "flight", dot: "bg-sky-500", activeClasses: FLIGHT_PILL_CLASSES },
  { category: "transport", dot: "bg-violet-500", activeClasses: TRANSPORT_PILL_CLASSES },
  { category: "itinerary", dot: "bg-amber-500", activeClasses: ITINERARY_PILL_CLASSES },
  { category: "accommodation", dot: "bg-emerald-500", activeClasses: ACCOMMODATION_BANNER_CLASSES },
];

/** One combined, chronologically-sorted list entry — a flight, bus/train
 * leg, itinerary item, or accommodation — used by the "whole trip" view
 * and by clicking a legend swatch to see just that one category. Flights
 * and transport legs with no date sort to the end rather than the top. */
type EventDescriptor = {
  key: string;
  sortKey: string;
  category: EventCategory;
  dotClass: string;
  title: string;
  subtitle?: string;
  locationName?: string | null;
  locationUrl?: string | null;
  bookingConfirmation?: string | null;
  instructions?: string | null;
  notes?: string | null;
  onEdit: () => void;
  onDelete: () => void;
};

function buildAllEvents(
  flights: TravelFlightRow[],
  transport: TravelTransportRow[],
  itinerary: TravelItineraryRow[],
  accommodations: TravelAccommodationRow[],
  actions: CalendarActions,
): EventDescriptor[] {
  const events: EventDescriptor[] = [];
  for (const f of flights) {
    events.push({
      key: `f-${f.id}`,
      sortKey: `${f.flight_date ?? "9999-99-99"} ${f.departure_time ?? "00:00"}`,
      category: "flight",
      dotClass: "bg-sky-500",
      title: flightLabel(f),
      subtitle:
        [f.flight_date ? formatDate(f.flight_date) : null, formatTimeRange(f.departure_time, f.arrival_time)]
          .filter(Boolean)
          .join(" · ") || undefined,
      notes: f.notes,
      onEdit: () => actions.onEditFlight(f),
      onDelete: () => actions.onDeleteFlight(f.id),
    });
  }
  for (const t of transport) {
    events.push({
      key: `t-${t.id}`,
      sortKey: `${t.travel_date ?? "9999-99-99"} ${t.departure_time ?? "00:00"}`,
      category: "transport",
      dotClass: "bg-violet-500",
      title: transportLabel(t),
      subtitle:
        [t.travel_date ? formatDate(t.travel_date) : null, formatTimeRange(t.departure_time, t.arrival_time)]
          .filter(Boolean)
          .join(" · ") || undefined,
      notes: t.notes,
      onEdit: () => actions.onEditTransport(t),
      onDelete: () => actions.onDeleteTransport(t.id),
    });
  }
  for (const item of itinerary) {
    events.push({
      key: `i-${item.id}`,
      sortKey: `${item.item_date} ${item.start_time ?? "00:00"}`,
      category: "itinerary",
      dotClass: "bg-amber-500",
      title: item.activity,
      subtitle: itineraryDetailSubtitle(item, true),
      locationName: item.location_name,
      locationUrl: mapsUrlFor(item.location_name, item.location_map_url),
      notes: item.notes,
      onEdit: () => actions.onEditItinerary(item),
      onDelete: () => actions.onDeleteItinerary(item.id),
    });
  }
  for (const a of accommodations) {
    events.push({
      key: `a-${a.id}`,
      sortKey: `${a.checkin_date} 00:00`,
      category: "accommodation",
      dotClass: "bg-emerald-500",
      title: accommodationLabel(a),
      subtitle: accommodationDetailSubtitle(a),
      locationName: a.location_name,
      locationUrl: mapsUrlFor(a.location_name, a.location_map_url),
      bookingConfirmation: a.booking_confirmation,
      instructions: a.instructions,
      notes: a.notes,
      onEdit: () => actions.onEditAccommodation(a),
      onDelete: () => actions.onDeleteAccommodation(a.id),
    });
  }
  return events.sort((x, y) => x.sortKey.localeCompare(y.sortKey));
}

function DayDetails({
  iso,
  flights,
  transport,
  itinerary,
  accommodations,
  actions,
  onClose,
}: {
  iso: string;
  flights: TravelFlightRow[];
  transport: TravelTransportRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  actions: CalendarActions;
  onClose: () => void;
}) {
  const dayFlights = flights.filter((f) => f.flight_date === iso);
  const dayTransport = transport.filter((t) => t.travel_date === iso);
  const dayItinerary = itinerary.filter(
    (item) => item.item_date <= iso && iso <= (item.item_end_date ?? item.item_date),
  );
  const dayAccommodations = accommodations.filter(
    (a) => a.checkin_date <= iso && iso <= a.checkout_date,
  );
  const hasAny =
    dayFlights.length > 0 ||
    dayTransport.length > 0 ||
    dayItinerary.length > 0 ||
    dayAccommodations.length > 0;

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {formatDate(iso)}
        </h6>
        <button type="button" onClick={onClose} className={CLOSE_BUTTON_CLASSES}>
          Close
        </button>
      </div>
      {!hasAny && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing logged for this day.</p>
      )}
      <div className="flex flex-col gap-3 text-sm">
        {dayFlights.map((f) => (
          <DetailRow
            key={`f-${f.id}`}
            dotClass="bg-sky-500"
            title={flightLabel(f)}
            subtitle={formatTimeRange(f.departure_time, f.arrival_time)}
            notes={f.notes}
            saving={actions.saving}
            onEdit={() => actions.onEditFlight(f)}
            onDelete={() => actions.onDeleteFlight(f.id)}
          />
        ))}
        {dayTransport.map((t) => (
          <DetailRow
            key={`t-${t.id}`}
            dotClass="bg-violet-500"
            title={transportLabel(t)}
            subtitle={formatTimeRange(t.departure_time, t.arrival_time)}
            notes={t.notes}
            saving={actions.saving}
            onEdit={() => actions.onEditTransport(t)}
            onDelete={() => actions.onDeleteTransport(t.id)}
          />
        ))}
        {dayItinerary.map((item) => (
          <DetailRow
            key={`i-${item.id}`}
            dotClass="bg-amber-500"
            title={item.activity}
            subtitle={itineraryDetailSubtitle(item, false)}
            locationName={item.location_name}
            locationUrl={mapsUrlFor(item.location_name, item.location_map_url)}
            notes={item.notes}
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
            subtitle={accommodationDetailSubtitle(a)}
            locationName={a.location_name}
            locationUrl={mapsUrlFor(a.location_name, a.location_map_url)}
            bookingConfirmation={a.booking_confirmation}
            instructions={a.instructions}
            notes={a.notes}
            saving={actions.saving}
            onEdit={() => actions.onEditAccommodation(a)}
            onDelete={() => actions.onDeleteAccommodation(a.id)}
          />
        ))}
      </div>
      <div className={`flex justify-end ${hasAny ? "mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800" : "mt-3"}`}>
        <button
          type="button"
          disabled={actions.saving}
          onClick={() => actions.onAddItinerary(iso)}
          className={ADD_BUTTON_CLASSES}
        >
          + Add itinerary item
        </button>
      </div>
    </div>
  );
}

/** The "Show whole trip" view: every flight, bus/train leg, itinerary item,
 * and stay across every month of the trip, in one chronological list — not
 * just the currently viewed month or a single clicked day. Pass `category`
 * (set by clicking a legend swatch) to narrow that down to just one kind. */
function TripFullSpanDetails({
  flights,
  transport,
  itinerary,
  accommodations,
  category,
  actions,
  onClose,
}: {
  flights: TravelFlightRow[];
  transport: TravelTransportRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  category: EventCategory | null;
  actions: CalendarActions;
  onClose: () => void;
}) {
  const allEvents = buildAllEvents(flights, transport, itinerary, accommodations, actions);
  const events = category ? allEvents.filter((e) => e.category === category) : allEvents;
  const heading = category
    ? CATEGORY_LABELS[category].heading
    : "Whole trip — every flight, bus/train leg, itinerary item, and stay";

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{heading}</h6>
        <button type="button" onClick={onClose} className={CLOSE_BUTTON_CLASSES}>
          Close
        </button>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing logged yet.</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {events.map((e) => (
            <DetailRow
              key={e.key}
              dotClass={e.dotClass}
              title={e.title}
              subtitle={e.subtitle}
              locationName={e.locationName}
              locationUrl={e.locationUrl}
              bookingConfirmation={e.bookingConfirmation}
              instructions={e.instructions}
              notes={e.notes}
              saving={actions.saving}
              onEdit={e.onEdit}
              onDelete={e.onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekRow({
  week,
  todayIso,
  flights,
  transport,
  itinerary,
  accommodations,
  selectedDate,
  onSelectDate,
}: {
  week: WeekDay[];
  todayIso: string;
  flights: TravelFlightRow[];
  transport: TravelTransportRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}) {
  const banners = bannersForWeek(week, spanItemsFor(itinerary, accommodations));
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
              className={`truncate rounded-md px-2 py-1 text-left text-xs font-semibold transition-opacity duration-150 hover:opacity-80 ${b.colorClasses}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 px-2 pb-2 pt-1">
        {week.map((d) => {
          const pills = pillsForDay(d.iso, flights, transport, itinerary);
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
  transport,
  itinerary,
  accommodations,
  actions,
  onClose,
}: {
  trip: TripCalendarTrip;
  flights: TravelFlightRow[];
  transport: TravelTransportRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
  actions: CalendarActions;
  onClose: () => void;
}) {
  const [viewYear, setViewYear] = useState(trip.entry_year);
  const [viewMonth, setViewMonth] = useState(trip.entry_month);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // "all" is the "Show whole trip" toggle; a category is set by clicking
  // one of the legend swatches, narrowing the same span view to just that
  // kind. Only one of these (or a selected date) is ever active.
  const [spanFilter, setSpanFilter] = useState<"all" | EventCategory | null>(null);

  const today = toIsoDateLocal(new Date());
  const weeks = buildWeeks(viewYear, viewMonth);

  const goToMonth = (delta: number) => {
    const n = addMonths(viewYear, viewMonth, delta);
    setViewYear(n.y);
    setViewMonth(n.m);
  };

  /** True if any flight/transport/itinerary/accommodation touches this date. */
  const dayHasEvents = (iso: string): boolean =>
    flights.some((f) => f.flight_date === iso) ||
    transport.some((t) => t.travel_date === iso) ||
    itinerary.some((item) => item.item_date <= iso && iso <= (item.item_end_date ?? item.item_date)) ||
    accommodations.some((a) => a.checkin_date <= iso && iso <= a.checkout_date);

  const selectDate = (iso: string) => {
    setSpanFilter(null);
    const wasSelected = selectedDate === iso;
    setSelectedDate(wasSelected ? null : iso);
    // An empty date has nothing to review — go straight to logging
    // something there instead of showing a blank "Nothing logged" panel.
    if (!wasSelected && !dayHasEvents(iso)) {
      actions.onAddItinerary(iso);
    }
  };

  const toggleShowAll = () => {
    setSelectedDate(null);
    setSpanFilter((v) => (v === "all" ? null : "all"));
  };

  const toggleCategory = (category: EventCategory) => {
    setSelectedDate(null);
    setSpanFilter((v) => (v === category ? null : category));
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={`${trip.title} calendar`}
      backdropClassName="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm"
      dialogClassName="flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-white p-0 dark:bg-zinc-950"
    >
      <div className="grid shrink-0 grid-cols-1 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:grid-cols-3 sm:px-6">
        <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50 sm:justify-self-start">
          {trip.title}
        </h2>
        <div className="justify-self-center">
          <button
            type="button"
            onClick={toggleShowAll}
            className={spanFilter === "all" ? TOGGLE_ACTIVE_BUTTON_CLASSES : TOGGLE_INACTIVE_BUTTON_CLASSES}
          >
            {spanFilter === "all" ? "Hide whole trip" : "Show whole trip"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-self-end">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => goToMonth(-1)}
              className={ICON_BUTTON_CLASSES}
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
              className={ICON_BUTTON_CLASSES}
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className={`${ACTION_BUTTON_CLASSES} px-3.5 py-1.5 text-sm`}
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
            className={`${CLOSE_BUTTON_CLASSES} px-3.5 py-1.5 text-sm`}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400 sm:px-6">
        {LEGEND_ITEMS.map(({ category, dot, activeClasses }) => (
          <button
            key={category}
            type="button"
            onClick={() => toggleCategory(category)}
            title={`Show every ${CATEGORY_LABELS[category].legend.toLowerCase()} in this trip`}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-medium transition-colors duration-150 ${
              spanFilter === category
                ? activeClasses
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${dot}`} /> {CATEGORY_LABELS[category].legend}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddFlight(selectedDate ?? undefined)}
            className={ADD_BUTTON_CLASSES}
          >
            + Add flight
          </button>
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddTransport(selectedDate ?? undefined)}
            className={ADD_BUTTON_CLASSES}
          >
            + Add bus/train
          </button>
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddItinerary(selectedDate ?? undefined)}
            className={ADD_BUTTON_CLASSES}
          >
            + Add itinerary item
          </button>
          <button
            type="button"
            disabled={actions.saving}
            onClick={() => actions.onAddAccommodation(selectedDate ?? undefined)}
            className={ADD_BUTTON_CLASSES}
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
                transport={transport}
                itinerary={itinerary}
                accommodations={accommodations}
                selectedDate={selectedDate}
                onSelectDate={selectDate}
              />
            ))}
          </div>

          {spanFilter ? (
            <TripFullSpanDetails
              flights={flights}
              transport={transport}
              itinerary={itinerary}
              accommodations={accommodations}
              category={spanFilter === "all" ? null : spanFilter}
              actions={actions}
              onClose={() => setSpanFilter(null)}
            />
          ) : (
            selectedDate && (
              <DayDetails
                iso={selectedDate}
                flights={flights}
                transport={transport}
                itinerary={itinerary}
                accommodations={accommodations}
                actions={actions}
                onClose={() => setSelectedDate(null)}
              />
            )
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
 * grid, with edit/delete on each item — the same create/update/delete flow
 * as the trip card's own list sections, just reachable from inside the
 * calendar too. "Show whole trip" swaps that agenda for every event across
 * every month of the trip in one list. */
export function TripCalendar({
  trip,
  flights,
  transport,
  itinerary,
  accommodations,
  ...actions
}: {
  trip: TripCalendarTrip;
  flights: TravelFlightRow[];
  transport: TravelTransportRow[];
  itinerary: TravelItineraryRow[];
  accommodations: TravelAccommodationRow[];
} & CalendarActions) {
  const [open, setOpen] = useState(false);
  const total = flights.length + transport.length + itinerary.length + accommodations.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {total === 0
          ? "Nothing logged yet."
          : `${flights.length} flight${flights.length === 1 ? "" : "s"} · ${transport.length} bus/train leg${transport.length === 1 ? "" : "s"} · ${itinerary.length} itinerary item${itinerary.length === 1 ? "" : "s"} · ${accommodations.length} stay${accommodations.length === 1 ? "" : "s"}`}
      </p>
      <button type="button" className={PRIMARY_BUTTON_CLASSES} onClick={() => setOpen(true)}>
        Open full calendar
      </button>
      {open && (
        <FullScreenCalendar
          trip={trip}
          flights={flights}
          transport={transport}
          itinerary={itinerary}
          accommodations={accommodations}
          actions={actions}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
