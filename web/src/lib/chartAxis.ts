/**
 * Recharts `XAxis` shows every tick by default, which overlaps into unreadable
 * clutter once a chart has more than a handful of points — most noticeable on
 * narrow mobile widths. Skip enough ticks to keep roughly `maxTicks` labels
 * visible regardless of how many points are plotted.
 */
export function xAxisTickInterval(pointCount: number, maxTicks = 7): number {
  if (pointCount <= maxTicks) return 0;
  return Math.ceil(pointCount / maxTicks) - 1;
}

/**
 * Minimum pixel width for a chart's scrollable inner wrapper, so each point
 * gets enough horizontal room for its label regardless of the container's
 * actual (possibly phone-narrow) width — the chart becomes wider than the
 * viewport and pans/scrolls instead of squeezing every label into it. Capped
 * so a huge dataset doesn't produce an unusably long scroll track.
 */
export function chartScrollMinWidth(
  pointCount: number,
  pxPerPoint = 56,
  floorPx = 480,
  capPx = 6000,
): number {
  return Math.min(capPx, Math.max(floorPx, pointCount * pxPerPoint));
}
