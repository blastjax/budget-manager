"use client";

import { useEffect, useRef, useState } from "react";

export type PopoverPos = { top: number; left: number };

/**
 * Fixed-position popover placement computed from a trigger element's
 * bounding rect, so the popover renders directly in the viewport instead
 * of as a descendant positioned relative to a (possibly overflow-clipped)
 * ancestor — e.g. a modal dialog with `overflow-y-auto`: per the CSS
 * overflow spec, once one axis is non-`visible` the other is forced to
 * `auto` too, so anything that would've spilled past the dialog's edge
 * gets clipped/scrolled instead of shown. A date picker anchored to a
 * field near a form's right edge used to be cut off by exactly this.
 *
 * Returns the trigger ref to attach to the trigger element, `open` state,
 * `openAt(width)` to compute position (clamped to the viewport, flipping
 * above the trigger when there's no room below) and open, `close()`, and
 * `position` (null until opened). Closes automatically on scroll/resize so
 * a stale-positioned popover can't visually detach from its trigger.
 */
export function usePopoverPosition<T extends HTMLElement>(estimatedHeight = 360) {
  const triggerRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPos | null>(null);

  const openAt = (width: number) => {
    const el = triggerRef.current;
    if (el) {
      const margin = 8;
      const rect = el.getBoundingClientRect();
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - width - margin),
      );
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < estimatedHeight + margin && rect.top > estimatedHeight
          ? Math.max(margin, rect.top - estimatedHeight - 8)
          : rect.bottom + 8;
      setPosition({ top, left });
    }
    setOpen(true);
  };

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => close();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return { triggerRef, open, position, openAt, close };
}
