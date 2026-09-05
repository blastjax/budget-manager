"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarMonth, type DayState } from "@/components/CalendarMonth";
import { addMonths, formatDate, toIsoDateLocal } from "@/lib/dateFormat";
import { usePopoverPosition } from "@/lib/usePopoverPosition";
import { ACTION_BUTTON_CLASSES, INPUT_CLASSES } from "@/lib/ui";

export type DateRangePickerFieldProps = {
  /** "YYYY-MM-DD", or "" for unset. */
  startValue: string;
  endValue: string;
  /** Called with the new (start, end) pair on every pick — `end` is "" right
   * after the first click, until a second date completes the range. */
  onChange: (start: string, end: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

const MAX_POPOVER_WIDTH = 680; // two months side by side

/** How wide the popover can actually be on this screen right now — capped
 * to the viewport (with margin) so it's never wider than there's room for. */
function responsiveWidth(): number {
  return Math.min(MAX_POPOVER_WIDTH, window.innerWidth - 16);
}

/** A button that opens a two-month calendar popover for picking a start/end
 * date pair (e.g. an accommodation's check-in/check-out) by clicking the
 * first date then the second, in place of two separate date inputs. Fixed-
 * positioned from the trigger's screen rect (see `usePopoverPosition`)
 * rather than anchored inside the form, so it can't be clipped by a
 * modal's scroll container. */
export function DateRangePickerField({
  startValue,
  endValue,
  onChange,
  disabled,
  placeholder = "Select dates",
}: DateRangePickerFieldProps) {
  const today = toIsoDateLocal(new Date());
  const base = startValue || endValue || today;
  const [anchorYear, setAnchorYear] = useState(() => Number(base.slice(0, 4)));
  const [anchorMonth, setAnchorMonth] = useState(() => Number(base.slice(5, 7)));
  const { triggerRef, open, position, openAt, close } = usePopoverPosition<HTMLButtonElement>(420);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverWidth, setPopoverWidth] = useState(MAX_POPOVER_WIDTH);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        close();
      }
    };
    // Capture phase + stopPropagation so Escape closes only this popover,
    // not the surrounding Modal (which listens for Escape on `window` too).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, triggerRef]);

  const openPicker = () => {
    if (disabled) return;
    const b = startValue || endValue || today;
    setAnchorYear(Number(b.slice(0, 4)));
    setAnchorMonth(Number(b.slice(5, 7)));
    const width = responsiveWidth();
    setPopoverWidth(width);
    openAt(width);
  };

  const pickDay = (iso: string) => {
    // No range started yet, or a full range is already picked -> start a new one.
    if (!startValue || (startValue && endValue)) {
      onChange(iso, "");
      return;
    }
    // One endpoint already picked -> this completes the range (swapping if
    // the new pick lands before the existing start).
    if (iso < startValue) {
      onChange(iso, startValue);
    } else {
      onChange(startValue, iso);
    }
    close();
  };

  const stateFor = (iso: string): DayState => {
    if (startValue && startValue === endValue && iso === startValue) return "selected";
    if (startValue && iso === startValue) return endValue ? "range-start" : "selected";
    if (endValue && iso === endValue) return "range-end";
    if (startValue && endValue && iso > startValue && iso < endValue) return "range-middle";
    if (iso === today) return "today";
    return "none";
  };

  const next = addMonths(anchorYear, anchorMonth, 1);
  const label =
    startValue && endValue
      ? `${formatDate(startValue)} – ${formatDate(endValue)}`
      : startValue
        ? `${formatDate(startValue)} – …`
        : "";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${INPUT_CLASSES} w-full text-left disabled:opacity-50`}
      >
        {label || <span className="text-ink-4">{placeholder}</span>}
      </button>
      {open && position && (
        <div
          ref={popoverRef}
          style={{ position: "fixed", top: position.top, left: position.left, width: popoverWidth }}
          className="z-50 rounded-xl border border-line bg-surface p-4 shadow-pop"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CalendarMonth
              year={anchorYear}
              month={anchorMonth}
              onSelectDay={pickDay}
              dayState={stateFor}
              onPrev={() => {
                const p = addMonths(anchorYear, anchorMonth, -1);
                setAnchorYear(p.y);
                setAnchorMonth(p.m);
              }}
            />
            <div className="hidden sm:block">
              <CalendarMonth
                year={next.y}
                month={next.m}
                onSelectDay={pickDay}
                dayState={stateFor}
                onNext={() => {
                  const n = addMonths(anchorYear, anchorMonth, 1);
                  setAnchorYear(n.y);
                  setAnchorMonth(n.m);
                }}
              />
            </div>
          </div>
          <div className="mt-2 flex justify-end sm:hidden">
            <button
              type="button"
              className={`${ACTION_BUTTON_CLASSES} px-3.5 py-1.5 text-xs`}
              onClick={() => {
                const n = addMonths(anchorYear, anchorMonth, 1);
                setAnchorYear(n.y);
                setAnchorMonth(n.m);
              }}
            >
              Next month ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
