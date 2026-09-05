/**
 * Shared className strings for patterns that should be byte-identical across
 * every page instead of copy-pasted (and drifting) per file.
 *
 * Design language: fully-rounded ("pill") buttons on an AMOLED-black base.
 * Every button carries a tone, so intent is readable before the label is —
 * indigo goes, sky edits, red destroys, teal inspects, violet acts, amber
 * backs out. All tints share one formula (border-2 + -50 fill + -700 text,
 * inverted in dark), so a new tone is a hue swap and nothing else. Surfaces
 * stay border-led with tight small radii; only buttons go fully round.
 */

/** The one raised surface tier above the page floor (cards, panels, tables). */
export const CARD_CLASSES =
  "rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:p-6";

export const DASHED_EMPTY_CLASSES =
  "rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-500";

/** Tone triad (border / bg / text) for inline banners — status, warnings, results. */
export function alertClasses(
  tone: "error" | "warning" | "success" | "info" = "error",
): string {
  switch (tone) {
    case "success":
      return "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "warning":
      return "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
    case "info":
      return "rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300";
    case "error":
    default:
      return "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  }
}

export const ERROR_ALERT_CLASSES = alertClasses("error");

/* -------------------------------------------------------------------------
 * Buttons
 *
 * One pill language for the whole app. Pick by intent, not by looks:
 *
 *   PRIMARY   indigo, filled — submit / confirm, the one solid button in a form
 *   ADD       indigo  — add a new record
 *   EDIT      sky     — row-level edit
 *   DELETE    red     — row-level destructive (delete / remove)
 *   DETAIL    teal    — compact row action that inspects or toggles
 *   ACTION    violet  — standalone page action ("Today", "Clear all", "Retry")
 *   SECONDARY amber   — cancel / back out, beside a primary
 *   CLOSE     amber   — dismiss a modal or expanded panel (compact SECONDARY)
 *   ICON      indigo  — round 36px icon-only control (chevrons, arrows)
 *   TOGGLE_*  indigo  — two-state pill; pick active or inactive per render
 *
 * PRIMARY/SECONDARY carry form-footer weight (text-sm); the row-level
 * variants are compact (text-xs). Prefer a constant as-is — appending padding
 * or size utilities re-opens the drift these exist to prevent.
 * ---------------------------------------------------------------------- */

export const PRIMARY_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:opacity-50";

export const SECONDARY_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition-colors duration-150 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70";

/** A standalone, non-destructive page action ("Today", "Clear all", "Retry"). */
export const ACTION_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors duration-150 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-950/70";

export const ADD_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-indigo-300 bg-indigo-50 px-4 py-1.5 text-xs font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70";

export const EDIT_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors duration-150 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70";

export const DELETE_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70";

/** Compact sibling of EDIT for inspecting or toggling a row ("Details", "Hide"). */
export const DETAIL_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 transition-colors duration-150 hover:bg-teal-100 disabled:opacity-50 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-950/70";

export const CLOSE_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-amber-300 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-700 transition-colors duration-150 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70";

/** A round icon button (prev/next month arrows, chevrons). */
export const ICON_BUTTON_CLASSES =
  "flex h-9 w-9 items-center justify-center rounded-full text-indigo-600 transition-colors duration-150 hover:bg-indigo-100 disabled:invisible dark:text-indigo-400 dark:hover:bg-indigo-950/40";

/** A pill toggle — active/inactive tone pair for a two-state control. */
export const TOGGLE_ACTIVE_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500";
export const TOGGLE_INACTIVE_BUTTON_CLASSES =
  "whitespace-nowrap rounded-full border-2 border-indigo-300 bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70";

export const INPUT_CLASSES =
  "rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 dark:border-zinc-700 dark:text-zinc-100";

export const LOADING_TEXT_CLASSES = "text-sm text-zinc-500 dark:text-zinc-500";

/** Segmented-control (pill toggle) pieces: wrapper + button + active/inactive state. */
export const SEGMENTED_WRAPPER_CLASSES =
  "inline-flex rounded-full border border-zinc-200 bg-zinc-100/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60";
export const SEGMENTED_BUTTON_CLASSES =
  "rounded-full px-3.5 py-1 text-sm font-medium transition-colors duration-150";
export const SEGMENTED_BUTTON_ACTIVE_CLASSES =
  "bg-indigo-600 text-white shadow-sm";
export const SEGMENTED_BUTTON_INACTIVE_CLASSES =
  "text-indigo-600 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-indigo-950/40";

/** Small round icon button used for chart zoom in/out controls. */
export const CHART_ZOOM_BUTTON_CLASSES =
  "flex h-7 min-w-7 select-none items-center justify-center rounded-full border-2 border-indigo-300 bg-indigo-50 text-sm font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 disabled:pointer-events-none disabled:opacity-40 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70";

/** Table primitives — one consistent look for every hand-rolled data table. */
export const TABLE_WRAPPER_CLASSES =
  "overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800";
export const TABLE_HEAD_ROW_CLASSES =
  "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60";
export const TABLE_HEAD_CELL_CLASSES =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
export const TABLE_ROW_CLASSES =
  "border-b border-zinc-100 last:border-0 transition-colors duration-150 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50";
export const TABLE_CELL_CLASSES =
  "px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 tabular-nums";

/** Signed-amount coloring — positive/negative, tuned for AMOLED contrast. */
export const AMOUNT_POSITIVE_CLASSES =
  "font-medium tabular-nums text-emerald-600 dark:text-emerald-400";
export const AMOUNT_NEGATIVE_CLASSES =
  "font-medium tabular-nums text-red-600 dark:text-red-400";
