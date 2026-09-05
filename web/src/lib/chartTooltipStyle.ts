import type { CSSProperties } from "react";
import type { BudgetTheme } from "./theme";

/**
 * Recharts `<Tooltip contentStyle={...}>` object, theme-aware. Previously this
 * exact object (light + dark variants) was hand-copied into Blood Pressure,
 * Commission, and Salary Stats — kept here once so the three charts stay in
 * sync and any future page just imports it.
 */
export function getChartTooltipStyle(theme: BudgetTheme): CSSProperties {
  // Mirrors the card surface / line tokens in globals.css — a tooltip is just
  // a very small card, and reading as one is the whole point.
  return theme === "dark"
    ? {
        backgroundColor: "rgba(23, 23, 24, 0.95)",
        border: "1px solid #2b2c2e",
        borderRadius: "10px",
        boxShadow: "0 12px 16px -4px rgba(0, 0, 0, 0.55)",
        fontSize: "12px",
        color: "rgba(255, 255, 255, 0.92)",
      }
    : {
        backgroundColor: "rgba(255, 255, 255, 0.97)",
        border: "1px solid #e8e8e8",
        borderRadius: "10px",
        boxShadow: "0 12px 16px -4px rgba(16, 24, 40, 0.08)",
        fontSize: "12px",
        color: "#18181b",
      };
}
