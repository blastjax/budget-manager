import { getPayslipDefaults, savePayslipDefaults } from "@/lib/api";
import { parseFormNumber } from "@/lib/parseFormNumber";

export type FormState = {
  period_year: string;
  period_month: string;
  period_half: "" | "1" | "2";
  total: string;
  basic_salary: string;
  commission: string;
  reimbursement: string;
  medical_reimbursement: string;
  others: string;
  mp2: string;
  allowances: string;
  thirteenth_month: string;
  notes: string;
  withholding_tax: string;
  sss_contribution: string;
  philhealth: string;
  pag_ibig: string;
};

export const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function emptyForm(): FormState {
  return {
    period_year: "",
    period_month: "",
    period_half: "",
    total: "",
    basic_salary: "",
    commission: "",
    reimbursement: "",
    medical_reimbursement: "",
    others: "",
    mp2: "",
    allowances: "",
    thirteenth_month: "",
    notes: "",
    withholding_tax: "",
    sss_contribution: "",
    philhealth: "",
    pag_ibig: "",
  };
}

function parseOptYear(s: string): number | null {
  const n = parseFormNumber(s);
  if (n == null) return null;
  const y = Math.trunc(n);
  if (y < 1900 || y > 2200) return null;
  return y;
}

export function tryParseFormStateJson(raw: string): FormState | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const x = o as Record<string, unknown>;
    const base = emptyForm();
    (Object.keys(base) as (keyof FormState)[]).forEach((k) => {
      const v = x[k as string];
      if (typeof v === "string") {
        (base as Record<string, string>)[k] = v;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        (base as Record<string, string>)[k] = String(v);
      }
    });
    if (
      base.period_half !== "" &&
      base.period_half !== "1" &&
      base.period_half !== "2"
    ) {
      base.period_half = "";
    }
    return base;
  } catch {
    return null;
  }
}

/** Pre-database storage location (browser-local, per-device). Read once, on
 * the first successful fetch from the database, to migrate any values a
 * user had already customized there — then left alone. */
const LS_PAYSLIP_MODAL_DEFAULTS_LEGACY = "blastjax:payslip:modalDefaults";

const BUILTIN_MODAL_DEFAULTS: Pick<FormState, "mp2" | "allowances"> = {
  mp2: "5,000.00",
  allowances: "1,108.30",
};

/** Settings toggle / last-selected half (first vs second template). */
export type PayslipPrefillHalfMode = "first" | "second";

export type PayslipDefaultsBundle = {
  formFirst: FormState;
  formSecond: FormState;
  settingsHalf: PayslipPrefillHalfMode;
};

const defaultFormWithBuiltin = (): FormState => ({
  ...emptyForm(),
  ...BUILTIN_MODAL_DEFAULTS,
});

const defaultSettingsHalf = (): PayslipPrefillHalfMode => "first";

function formFirstFallback(): FormState {
  return { ...defaultFormWithBuiltin(), period_half: "1" };
}

function formSecondFallback(): FormState {
  return { ...defaultFormWithBuiltin(), period_half: "2" };
}

/** Same values `loadPayslipDefaultsBundle()` returns before the database fetch resolves (SSR-safe). */
export function getPayslipDefaultsBundleFallback(): PayslipDefaultsBundle {
  return {
    formFirst: formFirstFallback(),
    formSecond: formSecondFallback(),
    settingsHalf: defaultSettingsHalf(),
  };
}

export const PAYSLIP_DEFAULTS_SAVED_EVENT = "blastjax:payslip-defaults-saved";

export function notifyPayslipDefaultsSaved(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PAYSLIP_DEFAULTS_SAVED_EVENT));
}

function parseSettingsHalf(rec: Record<string, unknown>): PayslipPrefillHalfMode {
  const m = rec.settingsHalf ?? rec.prefillHalfMode;
  if (m === "first" || m === "second") return m;
  if (m === "both") return "first";
  const legacy = rec.prefillHalves;
  if (legacy && typeof legacy === "object") {
    const o = legacy as Record<string, unknown>;
    const first = o.first === true;
    const second = o.second === true;
    if (first && second) return "first";
    if (first) return "first";
    if (second) return "second";
  }
  return defaultSettingsHalf();
}

function parseFormField(rec: Record<string, unknown>, key: string): FormState | null {
  const v = rec[key];
  if (!v || typeof v !== "object") return null;
  return tryParseFormStateJson(JSON.stringify(v));
}

/** Defaults used when opening the add modal for a calendar half (1 vs 2). */
export function payslipDefaultsFormForSlotHalf(
  bundle: PayslipDefaultsBundle,
  half: 1 | 2,
): FormState {
  return half === 1 ? bundle.formFirst : bundle.formSecond;
}

/** Reads the legacy browser-local bundle (pre-database storage). Used once,
 * to migrate a user's already-customized values into the database. */
function tryLoadLegacyLocalBundle(): PayslipDefaultsBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PAYSLIP_MODAL_DEFAULTS_LEGACY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;

    const ff = parseFormField(rec, "formFirst");
    const fs = parseFormField(rec, "formSecond");
    if (ff && fs) {
      return {
        formFirst: { ...ff, period_half: "1" },
        formSecond: { ...fs, period_half: "2" },
        settingsHalf: parseSettingsHalf(rec),
      };
    }

    if ("form" in rec && rec.form && typeof rec.form === "object") {
      const form = tryParseFormStateJson(JSON.stringify(rec.form));
      const merged = { ...defaultFormWithBuiltin(), ...(form ?? {}) };
      return {
        formFirst: { ...merged, period_half: "1" },
        formSecond: { ...merged, period_half: "2" },
        settingsHalf: parseSettingsHalf(rec),
      };
    }

    const legacy = tryParseFormStateJson(raw);
    if (legacy) {
      const merged = { ...defaultFormWithBuiltin(), ...legacy };
      return {
        formFirst: { ...merged, period_half: "1" },
        formSecond: { ...merged, period_half: "2" },
        settingsHalf: defaultSettingsHalf(),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function bundlesEqual(a: PayslipDefaultsBundle, b: PayslipDefaultsBundle): boolean {
  return (
    a.settingsHalf === b.settingsHalf &&
    JSON.stringify(a.formFirst) === JSON.stringify(b.formFirst) &&
    JSON.stringify(a.formSecond) === JSON.stringify(b.formSecond)
  );
}

function bundleFromApiResponse(resp: {
  formFirst: Record<string, unknown>;
  formSecond: Record<string, unknown>;
  settingsHalf: string;
}): PayslipDefaultsBundle {
  const fallback = getPayslipDefaultsBundleFallback();
  const ff = tryParseFormStateJson(JSON.stringify(resp.formFirst));
  const fs = tryParseFormStateJson(JSON.stringify(resp.formSecond));
  return {
    formFirst: ff ? { ...ff, period_half: "1" } : fallback.formFirst,
    formSecond: fs ? { ...fs, period_half: "2" } : fallback.formSecond,
    settingsHalf: resp.settingsHalf === "second" ? "second" : "first",
  };
}

function stripHalf(f: FormState): Omit<FormState, "period_half"> {
  const { period_half: _period_half, ...rest } = f;
  return rest;
}

let cachedDefaultsBundle: PayslipDefaultsBundle | null = null;

/**
 * Best-known form defaults, read synchronously from an in-memory cache
 * populated by `refreshPayslipDefaultsBundle()`. Falls back to the builtin
 * defaults (SSR-safe) until that first fetch from the database resolves.
 */
export function loadPayslipDefaultsBundle(): PayslipDefaultsBundle {
  return cachedDefaultsBundle ?? getPayslipDefaultsBundleFallback();
}

/**
 * Fetches the saved defaults bundle from the database and refreshes the
 * in-memory cache `loadPayslipDefaultsBundle()` reads from. The first time
 * this resolves to an unsaved (still-fallback) database bundle, it migrates
 * any pre-database browser-local values found so they aren't silently lost.
 */
export async function refreshPayslipDefaultsBundle(): Promise<PayslipDefaultsBundle> {
  let bundle: PayslipDefaultsBundle;
  try {
    bundle = bundleFromApiResponse(await getPayslipDefaults());
  } catch {
    return loadPayslipDefaultsBundle();
  }

  if (bundlesEqual(bundle, getPayslipDefaultsBundleFallback())) {
    const legacy = tryLoadLegacyLocalBundle();
    if (legacy && !bundlesEqual(legacy, getPayslipDefaultsBundleFallback())) {
      bundle = legacy;
      void savePayslipDefaultsBundle(legacy).catch(() => {
        /* migration best-effort; keep using the legacy values locally either way */
      });
    }
  }
  try {
    localStorage.removeItem(LS_PAYSLIP_MODAL_DEFAULTS_LEGACY);
  } catch {
    /* ignore */
  }

  cachedDefaultsBundle = bundle;
  return bundle;
}

/** Saves both half templates and the active-half toggle to the database. */
export async function savePayslipDefaultsBundle(
  bundle: PayslipDefaultsBundle,
): Promise<PayslipDefaultsBundle> {
  const resp = await savePayslipDefaults({
    form_first: stripHalf(bundle.formFirst),
    form_second: stripHalf(bundle.formSecond),
    settings_half: bundle.settingsHalf,
  });
  const saved = bundleFromApiResponse(resp);
  cachedDefaultsBundle = saved;
  notifyPayslipDefaultsSaved();
  return saved;
}

export function payPeriodFromToday(): Pick<
  FormState,
  "period_year" | "period_month" | "period_half"
> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const half: "1" | "2" = day >= 1 && day <= 15 ? "1" : "2";
  return {
    period_year: String(year),
    period_month: String(month),
    period_half: half,
  };
}

export function payPeriodFromDefaultsIfComplete(
  d: FormState,
): Pick<FormState, "period_year" | "period_month" | "period_half"> | null {
  const y = parseOptYear(d.period_year);
  if (y == null) return null;
  const mRaw = parseFormNumber(d.period_month);
  const month = mRaw != null ? Math.trunc(mRaw) : null;
  if (month == null || month < 1 || month > 12) return null;
  if (d.period_half !== "1" && d.period_half !== "2") return null;
  return {
    period_year: String(y),
    period_month: String(month),
    period_half: d.period_half,
  };
}

export function initialAddPayslipForm(
  year: number,
  month: number,
  half: 1 | 2,
  defaultsForHalf: FormState,
): FormState {
  const period = {
    period_year: String(year),
    period_month: String(month),
    period_half: String(half) as "1" | "2",
  };
  return {
    ...emptyForm(),
    ...defaultsForHalf,
    ...period,
  };
}

export function initialManualPayslipForm(
  bundle: PayslipDefaultsBundle,
): FormState {
  const today = payPeriodFromToday();
  const halfNum: 1 | 2 = bundle.settingsHalf === "second" ? 2 : 1;
  const defaults = halfNum === 1 ? bundle.formFirst : bundle.formSecond;
  const halfStr: "1" | "2" = halfNum === 2 ? "2" : "1";
  const fromDefaults = payPeriodFromDefaultsIfComplete(defaults);
  const period =
    fromDefaults != null
      ? {
          period_year: fromDefaults.period_year,
          period_month: fromDefaults.period_month,
          period_half: halfStr,
        }
      : {
          period_year: today.period_year,
          period_month: today.period_month,
          period_half: halfStr,
        };
  return {
    ...emptyForm(),
    ...defaults,
    ...period,
  };
}
