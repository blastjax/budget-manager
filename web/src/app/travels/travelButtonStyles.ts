/**
 * Bigger, fully-rounded, more saturated button styles used across the
 * Travels page and its modals — a deliberately louder variant of the
 * shared `lib/ui.ts` button classes, scoped to this feature so the rest of
 * the app keeps its normal button language.
 */

export const TRAVEL_PRIMARY_BUTTON =
  "rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:opacity-50";

export const TRAVEL_SECONDARY_BUTTON =
  "rounded-full border-2 border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors duration-150 hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800";

export const TRAVEL_ADD_BUTTON =
  "rounded-full border-2 border-indigo-300 bg-indigo-50 px-4 py-1.5 text-xs font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70";

export const TRAVEL_EDIT_BUTTON =
  "rounded-full border-2 border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors duration-150 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70";

export const TRAVEL_DELETE_BUTTON =
  "rounded-full border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70";

export const TRAVEL_CLOSE_BUTTON =
  "rounded-full border-2 border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** A round icon button (prev/next month arrows, chevrons). */
export const TRAVEL_ICON_BUTTON =
  "flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 disabled:invisible dark:text-zinc-400 dark:hover:bg-zinc-800";

/** A pill toggle — active/inactive tone pair for a two-state control (e.g. "Show whole trip"). */
export const TRAVEL_TOGGLE_ACTIVE_BUTTON =
  "rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500";
export const TRAVEL_TOGGLE_INACTIVE_BUTTON =
  "rounded-full border-2 border-indigo-300 bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70";
