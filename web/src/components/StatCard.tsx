import type { ReactNode } from "react";
import { CARD_CLASSES } from "@/lib/ui";

export type StatTone = "brand" | "success" | "danger" | "warning" | "info";

const ICON_TONE: Record<StatTone, string> = {
  brand: "bg-brand-soft text-brand-text",
  success: "bg-success-soft text-success-text",
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  info: "bg-info-soft text-info-text",
};

/**
 * The reference dashboard's overview tile: a tinted icon chip, the number at
 * display size, its label beneath, and an optional signed delta.
 *
 * `delta` is a *number*, not a string, so the arrow and the color are derived
 * from the sign in one place instead of each caller deciding — a "+" that
 * renders red is the kind of drift these components exist to prevent.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "brand",
  delta,
  deltaSuffix = "%",
  deltaLabel,
  /** Set when a rise is bad (spending, blood pressure) so the colors invert. */
  invertDelta = false,
  footer,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  delta?: number | null;
  deltaSuffix?: string;
  deltaLabel?: string;
  invertDelta?: boolean;
  footer?: ReactNode;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta > 0;
  const flat = hasDelta && delta === 0;
  const good = invertDelta ? !up : up;

  return (
    <div className={CARD_CLASSES}>
      {icon ? (
        <span
          className={`mb-4 inline-flex size-11 items-center justify-center rounded-full ${ICON_TONE[tone]}`}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold tabular-nums tracking-[-0.4px] text-ink">
            {value}
          </p>
          <p className="mt-1 truncate text-sm text-ink-3">{label}</p>
        </div>

        {hasDelta ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums ${
              flat ? "text-ink-3" : good ? "text-success-text" : "text-danger-text"
            }`}
            title={deltaLabel}
          >
            {Math.abs(delta).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}
            {deltaSuffix}
            {flat ? null : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`size-4 ${up ? "" : "rotate-180"}`}
                aria-hidden
              >
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            )}
          </span>
        ) : null}
      </div>

      {footer ? <div className="mt-3 text-xs text-ink-4">{footer}</div> : null}
    </div>
  );
}

/** Responsive row of stat tiles — the dashboard's opening band. */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
  );
}
