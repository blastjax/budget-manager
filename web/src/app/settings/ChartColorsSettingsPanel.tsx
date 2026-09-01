"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import {
  CHART_SERIES_COLOR_KEYS,
  CHART_SERIES_LABEL,
  defaultChartPalette,
  loadChartPalette,
  normalizeHexForColorInput,
  saveChartPalette,
  type ChartPaletteByTheme,
} from "@/lib/chartPalette";
import type { BudgetTheme } from "@/lib/theme";
import {
  CARD_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
  SEGMENTED_BUTTON_ACTIVE_CLASSES,
  SEGMENTED_BUTTON_CLASSES,
  SEGMENTED_BUTTON_INACTIVE_CLASSES,
  SEGMENTED_WRAPPER_CLASSES,
} from "@/lib/ui";

export function ChartColorsSettingsPanel() {
  const { setTheme } = useTheme();
  const [chartPalette, setChartPalette] = useState<ChartPaletteByTheme>(() =>
    loadChartPalette(),
  );
  const [paletteEditorTheme, setPaletteEditorTheme] =
    useState<BudgetTheme>("light");
  const [paletteSaveMsg, setPaletteSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!paletteSaveMsg) return;
    const t = window.setTimeout(() => setPaletteSaveMsg(null), 2800);
    return () => window.clearTimeout(t);
  }, [paletteSaveMsg]);

  return (
    <section className={CARD_CLASSES}>
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        Chart colors
      </h2>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          Editing palette for
        </span>
        <div className={SEGMENTED_WRAPPER_CLASSES} role="tablist" aria-label="Palette theme">
          <button
            type="button"
            role="tab"
            aria-selected={paletteEditorTheme === "light"}
            className={`${SEGMENTED_BUTTON_CLASSES} ${
              paletteEditorTheme === "light"
                ? SEGMENTED_BUTTON_ACTIVE_CLASSES
                : SEGMENTED_BUTTON_INACTIVE_CLASSES
            }`}
            onClick={() => setPaletteEditorTheme("light")}
          >
            Light mode
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={paletteEditorTheme === "dark"}
            className={`${SEGMENTED_BUTTON_CLASSES} ${
              paletteEditorTheme === "dark"
                ? SEGMENTED_BUTTON_ACTIVE_CLASSES
                : SEGMENTED_BUTTON_INACTIVE_CLASSES
            }`}
            onClick={() => setPaletteEditorTheme("dark")}
          >
            Dark mode
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className={SECONDARY_BUTTON_CLASSES} onClick={() => setTheme("light")}>
          App: light
        </button>
        <button type="button" className={SECONDARY_BUTTON_CLASSES} onClick={() => setTheme("dark")}>
          App: dark
        </button>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {CHART_SERIES_COLOR_KEYS.map((k) => (
          <label
            key={k}
            className="flex min-w-0 items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/40"
          >
            <span className="text-sm text-zinc-700 dark:text-zinc-200">
              {CHART_SERIES_LABEL[k]}
            </span>
            <input
              type="color"
              aria-label={`Color for ${CHART_SERIES_LABEL[k]} (${paletteEditorTheme})`}
              className="h-9 w-14 cursor-pointer rounded-md border border-zinc-300 bg-transparent p-0.5 dark:border-zinc-700"
              value={normalizeHexForColorInput(
                chartPalette[paletteEditorTheme][k],
              )}
              onChange={(e) => {
                const v = e.target.value;
                setChartPalette((p) => ({
                  ...p,
                  [paletteEditorTheme]: {
                    ...p[paletteEditorTheme],
                    [k]: v,
                  },
                }));
              }}
            />
          </label>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASSES}
          onClick={() => {
            saveChartPalette(chartPalette);
            setPaletteSaveMsg("Palette saved to this browser.");
          }}
        >
          Save palette
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASSES}
          onClick={() => {
            setChartPalette((p) => ({
              ...p,
              [paletteEditorTheme]: {
                ...defaultChartPalette()[paletteEditorTheme],
              },
            }));
            setPaletteSaveMsg(
              `Reset ${paletteEditorTheme} palette to built-in defaults (not saved yet).`,
            );
          }}
        >
          Reset {paletteEditorTheme} row
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASSES}
          onClick={() => {
            setChartPalette(defaultChartPalette());
            setPaletteSaveMsg(
              "Reset both light and dark to built-in defaults (not saved yet).",
            );
          }}
        >
          Reset all
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASSES}
          onClick={() => {
            setChartPalette(loadChartPalette());
            setPaletteSaveMsg("Reloaded palette from storage.");
          }}
        >
          Reload saved
        </button>
        {paletteSaveMsg && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            {paletteSaveMsg}
          </span>
        )}
      </div>
    </section>
  );
}
