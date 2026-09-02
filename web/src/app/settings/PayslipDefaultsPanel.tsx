"use client";

import { useCallback, useEffect, useState, type SetStateAction } from "react";
import {
  ACTION_BUTTON_CLASSES,
  CARD_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SEGMENTED_BUTTON_ACTIVE_CLASSES,
  SEGMENTED_BUTTON_CLASSES,
  SEGMENTED_BUTTON_INACTIVE_CLASSES,
  SEGMENTED_WRAPPER_CLASSES,
} from "@/lib/ui";
import { PayslipFormFields } from "../payslip/PayslipFormFields";
import {
  getPayslipDefaultsBundleFallback,
  notifyPayslipDefaultsSaved,
  refreshPayslipDefaultsBundle,
  savePayslipDefaultsBundle,
  type FormState,
  type PayslipPrefillHalfMode,
} from "../payslip/payslipModalForm";

const HALF_MODE_OPTIONS: { value: PayslipPrefillHalfMode; label: string }[] = [
  { value: "first", label: "First half" },
  { value: "second", label: "Second half" },
];

type HalfKey = "first" | "second";

function normalizeStoredForms(b: {
  formFirst: FormState;
  formSecond: FormState;
}): { first: FormState; second: FormState } {
  return {
    first: { ...b.formFirst, period_half: "1" },
    second: { ...b.formSecond, period_half: "2" },
  };
}

export function PayslipDefaultsPanel() {
  const fb = getPayslipDefaultsBundleFallback();
  const [activeHalf, setActiveHalf] = useState<PayslipPrefillHalfMode>(
    () => fb.settingsHalf,
  );
  const [formByHalf, setFormByHalf] = useState<{
    first: FormState;
    second: FormState;
  }>(() => normalizeStoredForms(fb));
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const displayedForm =
    activeHalf === "first" ? formByHalf.first : formByHalf.second;

  const setDisplayedForm = useCallback(
    (action: SetStateAction<FormState>) => {
      setFormByHalf((prev) => {
        const key: HalfKey = activeHalf === "first" ? "first" : "second";
        const cur = prev[key];
        const next =
          typeof action === "function"
            ? (action as (f: FormState) => FormState)(cur)
            : action;
        return { ...prev, [key]: next };
      });
    },
    [activeHalf],
  );

  useEffect(() => {
    let cancelled = false;
    void refreshPayslipDefaultsBundle().then((b) => {
      if (cancelled) return;
      setActiveHalf(b.settingsHalf);
      setFormByHalf(normalizeStoredForms(b));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!saveMsg) return;
    const t = window.setTimeout(() => setSaveMsg(null), 2800);
    return () => window.clearTimeout(t);
  }, [saveMsg]);

  return (
    <section className={CARD_CLASSES}>
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        Payslip defaults
      </h2>
      <fieldset className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900/40">
        <legend className="px-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          Edit defaults for
        </legend>
        <div
          className={`w-full max-w-md flex-col sm:flex-row sm:items-stretch ${SEGMENTED_WRAPPER_CLASSES}`}
          role="radiogroup"
          aria-label="Which half template to edit"
        >
          {HALF_MODE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={activeHalf === value}
              className={`flex-1 text-center sm:min-h-[2.75rem] ${SEGMENTED_BUTTON_CLASSES} ${
                activeHalf === value
                  ? SEGMENTED_BUTTON_ACTIVE_CLASSES
                  : SEGMENTED_BUTTON_INACTIVE_CLASSES
              }`}
              onClick={() => {
                setActiveHalf(value);
                setFormByHalf((prev) => ({
                  first: { ...prev.first, period_half: "1" },
                  second: { ...prev.second, period_half: "2" },
                }));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-8 min-w-0">
        <PayslipFormFields
          form={displayedForm}
          setForm={setDisplayedForm}
          requirePeriodHalf
        />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASSES}
          disabled={busy}
          onClick={async () => {
            const normalized = normalizeStoredForms({
              formFirst: formByHalf.first,
              formSecond: formByHalf.second,
            });
            setBusy(true);
            setErrorMsg(null);
            try {
              const saved = await savePayslipDefaultsBundle({
                formFirst: normalized.first,
                formSecond: normalized.second,
                settingsHalf: activeHalf,
              });
              setFormByHalf(normalizeStoredForms(saved));
              setSaveMsg("Defaults saved. Open add modals were updated.");
            } catch (e) {
              setErrorMsg(e instanceof Error ? e.message : "Save failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save defaults
        </button>
        <button
          type="button"
          className={ACTION_BUTTON_CLASSES}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErrorMsg(null);
            try {
              const b = await refreshPayslipDefaultsBundle();
              setActiveHalf(b.settingsHalf);
              setFormByHalf(normalizeStoredForms(b));
              setSaveMsg("Reloaded saved defaults.");
              notifyPayslipDefaultsSaved();
            } catch (e) {
              setErrorMsg(e instanceof Error ? e.message : "Reload failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          Reload saved
        </button>
        {saveMsg && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            {saveMsg}
          </span>
        )}
        {errorMsg && (
          <span className="text-sm text-red-700 dark:text-red-400">
            {errorMsg}
          </span>
        )}
      </div>
    </section>
  );
}
