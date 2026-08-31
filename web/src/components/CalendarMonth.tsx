"use client";

import { MONTH_NAMES_FULL } from "@/lib/dateFormat";

export type DayState = "none" | "today" | "selected" | "range-start" | "range-end" | "range-middle";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export type CalendarMonthProps = {
  year: number;
  /** 1-12 */
  month: number;
  onSelectDay: (iso: string) => void;
  dayState: (iso: string) => DayState;
  /** Omit to hide that arrow (its slot stays reserved so the title stays centered) —
   * used to put a single prev/next pair on the outer edges of a multi-month picker. */
  onPrev?: () => void;
  onNext?: () => void;
};

/** One month's day grid: header (title + optional prev/next) and a 7-column grid of
 * day cells. Used standalone for a single-date picker, or side by side (each with
 * only one of the nav arrows) for a range picker. */
export function CalendarMonth({
  year,
  month,
  onSelectDay,
  dayState,
  onPrev,
  onNext,
}: CalendarMonthProps) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={!onPrev}
          aria-label="Previous month"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 disabled:invisible dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ‹
        </button>
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {MONTH_NAMES_FULL[month - 1]} {year}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next month"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 disabled:invisible dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={i}
            className="pb-1 text-center text-[11px] font-medium text-zinc-400 dark:text-zinc-500"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day == null) return <div key={i} className="h-9" />;
          const iso = `${year}-${pad(month)}-${pad(day)}`;
          const state = dayState(iso);
          const col = i % 7;
          const isCap = state === "selected" || state === "range-start" || state === "range-end";
          const inRangeBg = state === "range-middle" || state === "range-start" || state === "range-end";
          const bgClasses = inRangeBg
            ? [
                "bg-indigo-50 dark:bg-indigo-950/40",
                (state === "range-start" || col === 0) && "rounded-l-full",
                (state === "range-end" || col === 6) && "rounded-r-full",
              ]
                .filter(Boolean)
                .join(" ")
            : "";
          return (
            <div key={i} className={`flex h-9 items-center justify-center ${bgClasses}`}>
              <button
                type="button"
                onClick={() => onSelectDay(iso)}
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm transition",
                  isCap
                    ? "bg-indigo-600 font-semibold text-white"
                    : state === "today"
                      ? "font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-400 dark:text-indigo-400"
                      : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-700/60",
                ].join(" ")}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
