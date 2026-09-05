/**
 * Shared className strings for patterns that should be byte-identical across
 * every page instead of copy-pasted (and drifting) per file.
 *
 * Design language: NextAdmin (demo.nextadmin.co). A grey page floor carries
 * white, hairline-bordered cards at `rounded-xl` with almost no shadow —
 * separation comes from the border and the floor beneath, not from elevation.
 * Type runs on four ink steps (`ink` → `ink-4`); one brand violet (#5750f1)
 * owns every affirmative action.
 *
 * Buttons are restrained on purpose: a *single* filled brand button per view,
 * neutral outlines beside it, ghosts for row-level chrome, and red reserved
 * for destruction. Intent is carried by weight — filled > outline > ghost —
 * rather than by hue, so a dense table doesn't turn into confetti. All of
 * them share one geometry (`rounded-lg`, `text-sm font-medium`, 4px focus
 * halo), so a new variant is a color swap and nothing else.
 *
 * Colors are always spelled as semantic tokens (`bg-surface`, `text-ink-2`,
 * `border-line`) defined in `globals.css` — never as raw palette steps — so
 * retheming stays a one-file change.
 */

/* -------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------- */

/** Standard page shell: centered column, consistent gutters and rhythm. */
export const PAGE_CONTAINER_CLASSES =
  "relative mx-auto flex w-full min-w-0 max-w-[1536px] flex-col gap-6 px-4 pb-28 pt-6 sm:gap-7 sm:px-6 sm:pb-10 xl:px-8";

/* -------------------------------------------------------------------------
 * Surfaces
 * ---------------------------------------------------------------------- */

/** The one raised surface tier above the page floor (cards, panels, tables). */
export const CARD_CLASSES =
  "rounded-xl border border-line bg-surface p-5 shadow-xs sm:p-6";

/** A card with no padding — for tables and lists that manage their own insets. */
export const CARD_FLUSH_CLASSES =
  "overflow-hidden rounded-xl border border-line bg-surface shadow-xs";

/** A recessed panel *inside* a card (nested groups, read-only summaries). */
export const INSET_PANEL_CLASSES =
  "rounded-lg border border-line bg-surface-2/60 p-4";

export const CARD_TITLE_CLASSES =
  "text-base font-semibold tracking-[-0.2px] text-ink";

export const CARD_DESCRIPTION_CLASSES = "mt-0.5 text-sm text-ink-3";

/** Small uppercase label above a group of related controls or stats. */
export const SECTION_LABEL_CLASSES =
  "text-xs font-medium uppercase tracking-wider text-ink-4";

export const DASHED_EMPTY_CLASSES =
  "rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3";

/** Modal dialog shell — matches the card language, one tier further up. */
export const MODAL_DIALOG_CLASSES =
  "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-pop sm:p-6";

/* -------------------------------------------------------------------------
 * Feedback
 * ---------------------------------------------------------------------- */

/** Tone triad (border / bg / text) for inline banners — status, warnings, results. */
export function alertClasses(
  tone: "error" | "warning" | "success" | "info" = "error",
): string {
  const base = "rounded-lg border px-4 py-3 text-sm";
  switch (tone) {
    case "success":
      return `${base} border-success-line bg-success-soft text-success-text`;
    case "warning":
      return `${base} border-warning-line bg-warning-soft text-warning-text`;
    case "info":
      return `${base} border-info-line bg-info-soft text-info-text`;
    case "error":
    default:
      return `${base} border-danger-line bg-danger-soft text-danger-text`;
  }
}

export const ERROR_ALERT_CLASSES = alertClasses("error");

/** Pill badge for statuses and counts inside tables and cards. */
export function badgeClasses(
  tone: "neutral" | "brand" | "success" | "warning" | "danger" | "info" =
    "neutral",
): string {
  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";
  switch (tone) {
    case "brand":
      return `${base} bg-brand-soft text-brand-text`;
    case "success":
      return `${base} bg-success-soft text-success-text`;
    case "warning":
      return `${base} bg-warning-soft text-warning-text`;
    case "danger":
      return `${base} bg-danger-soft text-danger-text`;
    case "info":
      return `${base} bg-info-soft text-info-text`;
    case "neutral":
    default:
      return `${base} bg-surface-2 text-ink-2`;
  }
}

export const LOADING_TEXT_CLASSES = "text-sm text-ink-3";

/* -------------------------------------------------------------------------
 * Buttons
 *
 * Pick by *emphasis*, not by looks. Only one filled button should be visible
 * in a given view:
 *
 *   PRIMARY   filled brand — submit / confirm, the one solid button in a form
 *   ADD       filled brand, compact — add a new record
 *   SECONDARY outline      — cancel / back out, beside a primary
 *   ACTION    soft brand   — standalone page action ("Today", "Clear all")
 *   EDIT      outline, compact — row-level edit
 *   CLOSE     outline, compact — dismiss a modal or expanded panel
 *   DETAIL    ghost, compact   — inspects or toggles a row ("Details", "Hide")
 *   DELETE    danger, compact  — row-level destructive
 *   ICON      ghost square     — icon-only control (chevrons, arrows)
 *   TOGGLE_*  filled / outline — two-state pill; pick per render
 *
 * Prefer a constant as-is — appending padding or size utilities re-opens the
 * drift these exist to prevent.
 * ---------------------------------------------------------------------- */

/** Geometry + motion shared by every button; never used on its own. */
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const BUTTON_MD = `${BUTTON_BASE} h-10 px-4 text-sm`;
const BUTTON_SM = `${BUTTON_BASE} h-8 px-3 text-xs`;

const FILL_BRAND = "bg-brand text-white shadow-xs hover:bg-brand-hover";
const OUTLINE_NEUTRAL =
  "border border-line-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink";
const SOFT_BRAND = "bg-brand-soft text-brand-text hover:bg-brand-soft-hover";
const GHOST_NEUTRAL = "text-ink-3 hover:bg-surface-2 hover:text-ink";
const OUTLINE_DANGER =
  "border border-danger/40 bg-danger-soft text-danger-text hover:border-danger/70";

export const PRIMARY_BUTTON_CLASSES = `${BUTTON_MD} ${FILL_BRAND}`;

export const SECONDARY_BUTTON_CLASSES = `${BUTTON_MD} ${OUTLINE_NEUTRAL}`;

/** A standalone, non-destructive page action ("Today", "Clear all", "Retry"). */
export const ACTION_BUTTON_CLASSES = `${BUTTON_MD} ${SOFT_BRAND}`;

/** Neutral outline at medium size — the generic "another option" button. */
export const OUTLINE_BUTTON_CLASSES = SECONDARY_BUTTON_CLASSES;

/** Filled red — a destructive *confirmation*, not a row action. */
export const DANGER_BUTTON_CLASSES = `${BUTTON_MD} bg-danger text-white shadow-xs hover:opacity-90`;

export const ADD_BUTTON_CLASSES = `${BUTTON_SM} ${FILL_BRAND}`;

export const EDIT_BUTTON_CLASSES = `${BUTTON_SM} ${OUTLINE_NEUTRAL}`;

export const DELETE_BUTTON_CLASSES = `${BUTTON_SM} ${OUTLINE_DANGER}`;

/** Compact sibling of EDIT for inspecting or toggling a row ("Details", "Hide"). */
export const DETAIL_BUTTON_CLASSES = `${BUTTON_SM} ${GHOST_NEUTRAL}`;

export const CLOSE_BUTTON_CLASSES = `${BUTTON_SM} ${OUTLINE_NEUTRAL}`;

/** Ghost button at medium size — low-emphasis chrome beside stronger actions. */
export const GHOST_BUTTON_CLASSES = `${BUTTON_MD} ${GHOST_NEUTRAL}`;

/** A square icon button (prev/next month arrows, chevrons, menu toggles). */
export const ICON_BUTTON_CLASSES =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:invisible";

/** A pill toggle — active/inactive tone pair for a two-state control. */
export const TOGGLE_ACTIVE_BUTTON_CLASSES = `${BUTTON_BASE} h-9 px-4 text-sm ${FILL_BRAND}`;
export const TOGGLE_INACTIVE_BUTTON_CLASSES = `${BUTTON_BASE} h-9 px-4 text-sm ${OUTLINE_NEUTRAL}`;

/* -------------------------------------------------------------------------
 * Form controls
 * ---------------------------------------------------------------------- */

export const INPUT_CLASSES =
  "rounded-lg border border-input-line bg-input-bg px-3.5 py-2.5 text-sm text-ink transition-colors duration-150 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20 disabled:opacity-60";

export const LABEL_CLASSES = "mb-1.5 block text-sm font-medium text-ink-2";

/** Segmented control: wrapper + button + active/inactive state. */
export const SEGMENTED_WRAPPER_CLASSES =
  "inline-flex rounded-lg border border-line bg-surface-2 p-1";
export const SEGMENTED_BUTTON_CLASSES =
  "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150";
export const SEGMENTED_BUTTON_ACTIVE_CLASSES =
  "bg-brand text-white shadow-xs";
export const SEGMENTED_BUTTON_INACTIVE_CLASSES =
  "text-ink-3 hover:text-ink";

/** Small square icon button used for chart zoom in/out controls. */
export const CHART_ZOOM_BUTTON_CLASSES =
  "flex h-7 min-w-7 select-none items-center justify-center rounded-md border border-line-strong bg-surface text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40";

/* -------------------------------------------------------------------------
 * Tables
 * ---------------------------------------------------------------------- */

/** Table primitives — one consistent look for every hand-rolled data table. */
export const TABLE_WRAPPER_CLASSES =
  "overflow-hidden rounded-xl border border-line bg-surface";
export const TABLE_HEAD_ROW_CLASSES = "border-b border-line bg-surface-2/50";
export const TABLE_HEAD_CELL_CLASSES =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3";
export const TABLE_ROW_CLASSES =
  "border-b border-line-soft last:border-0 transition-colors duration-150 hover:bg-surface-2/50";
export const TABLE_CELL_CLASSES = "px-4 py-3 text-sm text-ink-2 tabular-nums";

/* -------------------------------------------------------------------------
 * Data
 * ---------------------------------------------------------------------- */

/** Signed-amount coloring — positive / negative. */
export const AMOUNT_POSITIVE_CLASSES =
  "font-medium tabular-nums text-success-text";
export const AMOUNT_NEGATIVE_CLASSES =
  "font-medium tabular-nums text-danger-text";
