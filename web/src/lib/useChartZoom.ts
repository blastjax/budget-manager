import { useCallback, useState } from "react";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const DEFAULT_STEP_INDEX = ZOOM_STEPS.indexOf(1);

/**
 * Horizontal zoom for scrollable time-series charts: scales the per-point
 * pixel width fed into `chartScrollMinWidth`, so zooming in spreads points
 * further apart (more scroll, easier to read dense stretches) and zooming
 * out pulls them back together toward fitting the viewport.
 */
export function useChartZoom() {
  const [stepIndex, setStepIndex] = useState(DEFAULT_STEP_INDEX);

  const zoomIn = useCallback(() => {
    setStepIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  }, []);
  const zoomOut = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);
  const resetZoom = useCallback(() => setStepIndex(DEFAULT_STEP_INDEX), []);

  return {
    zoom: ZOOM_STEPS[stepIndex],
    zoomIn,
    zoomOut,
    resetZoom,
    canZoomIn: stepIndex < ZOOM_STEPS.length - 1,
    canZoomOut: stepIndex > 0,
  };
}
