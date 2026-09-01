"use client";

import { INPUT_CLASSES } from "@/lib/ui";

export type TimeFieldProps = {
  /** Raw text as typed — parsed/validated by the caller on submit (see
   * `parseOptionalTime24` in TravelsClient), same as this app's other
   * free-text date/number fields (e.g. Lotto's draw date). */
  value: string;
  onChange: (raw: string) => void;
  disabled?: boolean;
};

/** Plain "HH:MM" (24-hour) text entry — also accepts bare digits like
 * "1430" (parsed as 14:30). Deliberately not a native `<input type="time">`
 * (its on-screen face can render AM/PM depending on the browser/OS) and
 * not a dropdown — just a text field. */
export function TimeField({ value, onChange, disabled }: TimeFieldProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM or 1430"
      className={INPUT_CLASSES}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
