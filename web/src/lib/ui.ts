/**
 * Shared className strings for patterns that should be byte-identical across
 * every page instead of copy-pasted (and drifting) per file.
 *
 * Design language: Notion-style fluidity on an AMOLED-black base — border-led
 * elevation (no drop shadows on inline content), one restrained accent
 * (indigo) reserved for genuine calls-to-action/links/focus, muted text
 * hierarchy, tight small radii, and flat `transition-colors` interactions.
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

export const PRIMARY_BUTTON_CLASSES =
  "rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-indigo-500 disabled:opacity-50";

export const SECONDARY_BUTTON_CLASSES =
  "rounded-md border border-zinc-200 px-3.5 py-1.5 text-sm text-zinc-700 transition-colors duration-150 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800/60";

/** Borderless row/toolbar action — Notion's default at-rest button weight. */
export const GHOST_BUTTON_CLASSES =
  "rounded-md px-2 py-1 text-sm text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60";

export const INPUT_CLASSES =
  "rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-sm text-zinc-900 transition-colors duration-150 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 dark:border-zinc-700 dark:text-zinc-100";

export const LOADING_TEXT_CLASSES = "text-sm text-zinc-500 dark:text-zinc-500";

/** Segmented-control (pill toggle) pieces: wrapper + button + active/inactive state. */
export const SEGMENTED_WRAPPER_CLASSES =
  "inline-flex rounded-md border border-zinc-200 bg-zinc-100/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60";
export const SEGMENTED_BUTTON_CLASSES =
  "rounded-[5px] px-3 py-1 text-sm font-medium transition-colors duration-150";
export const SEGMENTED_BUTTON_ACTIVE_CLASSES =
  "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50";
export const SEGMENTED_BUTTON_INACTIVE_CLASSES =
  "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100";

/** Small square icon button used for chart zoom in/out controls. */
export const CHART_ZOOM_BUTTON_CLASSES =
  "flex h-7 min-w-7 select-none items-center justify-center rounded-md border border-zinc-200 text-sm font-medium text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800/60";

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

/** Modest, non-shouty card/section heading. */
export const SECTION_HEADING_CLASSES =
  "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
