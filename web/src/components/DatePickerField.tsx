"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarMonth } from "@/components/CalendarMonth";
import { addMonths, formatDate, toIsoDateLocal } from "@/lib/dateFormat";
import { INPUT_CLASSES } from "@/lib/ui";

export type DatePickerFieldProps = {
  /** "YYYY-MM-DD", or "" for no date picked. */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
};

/** A button that opens a small calendar popover to pick a single date, in
 * place of a native `<input type="date">`. */
export function DatePickerField({
  value,
  onChange,
  disabled,
  placeholder = "Select date",
  id,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const today = toIsoDateLocal(new Date());
  const base = value || today;
  const [viewYear, setViewYear] = useState(() => Number(base.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(base.slice(5, 7)));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Capture phase + stopPropagation so Escape closes only this popover,
    // not the surrounding Modal (which listens for Escape on `window` too).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    const b = value || today;
    setViewYear(Number(b.slice(0, 4)));
    setViewMonth(Number(b.slice(5, 7)));
    setOpen((o) => !o);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${INPUT_CLASSES} w-full text-left disabled:opacity-50`}
      >
        {value ? formatDate(value) : <span className="text-zinc-400">{placeholder}</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none dark:ring-1 dark:ring-white/10">
          <CalendarMonth
            year={viewYear}
            month={viewMonth}
            onSelectDay={(iso) => {
              onChange(iso);
              setOpen(false);
            }}
            dayState={(iso) => (iso === value ? "selected" : iso === today ? "today" : "none")}
            onPrev={() => {
              const p = addMonths(viewYear, viewMonth, -1);
              setViewYear(p.y);
              setViewMonth(p.m);
            }}
            onNext={() => {
              const n = addMonths(viewYear, viewMonth, 1);
              setViewYear(n.y);
              setViewMonth(n.m);
            }}
          />
        </div>
      )}
    </div>
  );
}
