import { CHART_ZOOM_BUTTON_CLASSES } from "@/lib/ui";

/** Zoom in/out controls for a scrollable time-series chart — pair with
 * `useChartZoom` and feed its `zoom` value into `chartScrollMinWidth`. */
export function ChartZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  canZoomIn,
  canZoomOut,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}) {
  return (
    <div
      className="inline-flex items-center gap-1.5"
      role="group"
      aria-label="Chart zoom"
    >
      <button
        type="button"
        className={CHART_ZOOM_BUTTON_CLASSES}
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        title="Reset zoom"
        className="min-w-[3.5rem] rounded-md px-1 py-1 text-center text-xs font-medium tabular-nums text-zinc-600 transition-colors duration-150 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className={CHART_ZOOM_BUTTON_CLASSES}
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
