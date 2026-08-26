"use client";

import { useCallback, useEffect, useState } from "react";
import { FloatingAddButton } from "@/components/FloatingAddButton";
import { Modal } from "@/components/Modal";
import {
  createLottoAttempt,
  deleteLottoAttempt,
  deleteLottoDraw,
  getLottoDraws,
  setLottoDraw,
  updateLottoAttempt,
  type LottoAttemptRow,
  type LottoDrawDetail,
} from "@/lib/api";
import { formatDate } from "@/lib/dateFormat";
import {
  CARD_CLASSES,
  DASHED_EMPTY_CLASSES,
  ERROR_ALERT_CLASSES,
  INPUT_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
} from "@/lib/ui";

const NUMBERS_HELP = "6 unique numbers, 1-58 (e.g. 3, 17, 29, 42, 58, 1)";

function parseNumbers(text: string): number[] {
  const parts = text.split(/[^0-9]+/).filter((p) => p.length > 0);
  if (parts.length !== 6) {
    throw new Error("Enter exactly 6 numbers.");
  }
  const numbers = parts.map((p) => Number(p));
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 58)) {
    throw new Error("Each number must be a whole number between 1 and 58.");
  }
  if (new Set(numbers).size !== numbers.length) {
    throw new Error("Numbers must be unique.");
  }
  return [...numbers].sort((a, b) => a - b);
}

function numbersToText(numbers: number[]): string {
  return numbers.join(", ");
}

function NumberBall({
  n,
  variant = "neutral",
}: {
  n: number;
  variant?: "neutral" | "result" | "match" | "miss";
}) {
  const styles: Record<string, string> = {
    neutral:
      "border-zinc-300 bg-white text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100",
    result:
      "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-100",
    match:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-500 dark:bg-emerald-600",
    miss: "border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500",
  };
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums ${styles[variant]}`}
    >
      {n}
    </span>
  );
}

type DrawModalState = { open: boolean; drawDate: string; numbersText: string; isEdit: boolean };
type AttemptModalState = {
  open: boolean;
  drawId: number | null;
  attemptId: number | null;
  numbersText: string;
};

const emptyDrawModal: DrawModalState = { open: false, drawDate: "", numbersText: "", isEdit: false };
const emptyAttemptModal: AttemptModalState = {
  open: false,
  drawId: null,
  attemptId: null,
  numbersText: "",
};

export default function LottoClient() {
  const [draws, setDraws] = useState<LottoDrawDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drawModal, setDrawModal] = useState<DrawModalState>(emptyDrawModal);
  const [drawFormError, setDrawFormError] = useState<string | null>(null);

  const [attemptModal, setAttemptModal] = useState<AttemptModalState>(emptyAttemptModal);
  const [attemptFormError, setAttemptFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getLottoDraws(500);
      setDraws(r.draws);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lotto results");
      setDraws([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upsertLocalDraw = (detail: LottoDrawDetail) => {
    setDraws((ds) => {
      const i = ds.findIndex((d) => d.draw.id === detail.draw.id);
      if (i === -1) {
        return [detail, ...ds].sort((a, b) => b.draw.draw_date.localeCompare(a.draw.draw_date));
      }
      const out = ds.slice();
      out[i] = detail;
      return out;
    });
  };

  const openAddDraw = () => {
    setDrawFormError(null);
    setDrawModal({ open: true, drawDate: "", numbersText: "", isEdit: false });
  };

  const openEditDraw = (detail: LottoDrawDetail) => {
    setDrawFormError(null);
    setDrawModal({
      open: true,
      drawDate: detail.draw.draw_date,
      numbersText: numbersToText(detail.draw.numbers),
      isEdit: true,
    });
  };

  const closeDrawModal = () => {
    setDrawModal(emptyDrawModal);
    setDrawFormError(null);
  };

  const submitDraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setDrawFormError(null);
    if (!drawModal.drawDate) {
      setDrawFormError("Pick a date.");
      return;
    }
    let numbers: number[];
    try {
      numbers = parseNumbers(drawModal.numbersText);
    } catch (err) {
      setDrawFormError(err instanceof Error ? err.message : "Invalid numbers");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const detail = await setLottoDraw(drawModal.drawDate, numbers);
      upsertLocalDraw(detail);
      closeDrawModal();
    } catch (err) {
      setDrawFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDeleteDraw = async (drawId: number) => {
    if (!confirm("Delete this result and all its attempts?")) return;
    setSaving(true);
    setError(null);
    try {
      await deleteLottoDraw(drawId);
      setDraws((ds) => ds.filter((d) => d.draw.id !== drawId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const openAddAttempt = (drawId: number) => {
    setAttemptFormError(null);
    setAttemptModal({ open: true, drawId, attemptId: null, numbersText: "" });
  };

  const openEditAttempt = (drawId: number, attempt: LottoAttemptRow) => {
    setAttemptFormError(null);
    setAttemptModal({
      open: true,
      drawId,
      attemptId: attempt.id,
      numbersText: numbersToText(attempt.numbers),
    });
  };

  const closeAttemptModal = () => {
    setAttemptModal(emptyAttemptModal);
    setAttemptFormError(null);
  };

  const submitAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptFormError(null);
    if (attemptModal.drawId == null) return;
    let numbers: number[];
    try {
      numbers = parseNumbers(attemptModal.numbersText);
    } catch (err) {
      setAttemptFormError(err instanceof Error ? err.message : "Invalid numbers");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const detail =
        attemptModal.attemptId != null
          ? await updateLottoAttempt(attemptModal.drawId, attemptModal.attemptId, numbers)
          : await createLottoAttempt(attemptModal.drawId, numbers);
      upsertLocalDraw(detail);
      closeAttemptModal();
    } catch (err) {
      setAttemptFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDeleteAttempt = async (drawId: number, attemptId: number) => {
    if (!confirm("Delete this attempt?")) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await deleteLottoAttempt(drawId, attemptId);
      upsertLocalDraw(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const anyModalOpen = drawModal.open || attemptModal.open;

  return (
    <div className="relative mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 px-4 pb-28 py-8 sm:px-6">
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Lotto
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Enter each date&apos;s result, then log your attempts underneath it — matching
          numbers turn green.
        </p>
      </header>

      {error && (
        <div className={ERROR_ALERT_CLASSES} role="alert">
          {error}
        </div>
      )}

      {!loading && draws.length === 0 && (
        <p className={DASHED_EMPTY_CLASSES}>No results yet — add one to get started.</p>
      )}

      <div className="flex flex-col gap-5">
        {draws.map((detail) => {
          const drawSet = new Set(detail.draw.numbers);
          return (
            <section key={detail.draw.id} className={CARD_CLASSES}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                    {formatDate(detail.draw.draw_date)}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.draw.numbers.map((n) => (
                      <NumberBall key={n} n={n} variant="result" />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1.5 text-xs sm:px-3 sm:text-sm`}
                    onClick={() => openEditDraw(detail)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:text-red-300 sm:px-3 sm:text-sm"
                    onClick={() => void onDeleteDraw(detail.draw.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Attempts
                  </h3>
                  <button
                    type="button"
                    disabled={saving}
                    className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1 text-xs`}
                    onClick={() => openAddAttempt(detail.draw.id)}
                  >
                    + Add attempt
                  </button>
                </div>

                {detail.attempts.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-500">
                    No attempts logged for this date yet.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {detail.attempts.map((attempt) => {
                      const matchCount = attempt.numbers.filter((n) => drawSet.has(n)).length;
                      return (
                        <li
                          key={attempt.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            {attempt.numbers.map((n) => (
                              <NumberBall key={n} n={n} variant={drawSet.has(n) ? "match" : "miss"} />
                            ))}
                            <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              {matchCount}/6 matched
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                              onClick={() => openEditAttempt(detail.draw.id, attempt)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:text-red-300"
                              onClick={() => void onDeleteAttempt(detail.draw.id, attempt.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Modal open={drawModal.open} onClose={closeDrawModal} ariaLabelledBy="lotto-draw-title">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 id="lotto-draw-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {drawModal.isEdit ? "Edit result" : "Add result"}
          </h2>
          <button
            type="button"
            className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
            onClick={closeDrawModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitDraw} className="flex flex-col gap-4">
          {drawFormError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {drawFormError}
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Draw date</span>
            <input
              required
              type="date"
              className={INPUT_CLASSES}
              value={drawModal.drawDate}
              disabled={saving || drawModal.isEdit}
              onChange={(e) => setDrawModal((m) => ({ ...m, drawDate: e.target.value }))}
            />
            {drawModal.isEdit && (
              <span className="text-xs text-zinc-500">
                Date can&apos;t be changed here — delete and re-add to move it.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Winning numbers</span>
            <input
              required
              type="text"
              inputMode="numeric"
              placeholder="3, 17, 29, 42, 58, 1"
              className={INPUT_CLASSES}
              value={drawModal.numbersText}
              disabled={saving}
              onChange={(e) => setDrawModal((m) => ({ ...m, numbersText: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">{NUMBERS_HELP}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={PRIMARY_BUTTON_CLASSES}>
              {saving ? "Saving…" : drawModal.isEdit ? "Update" : "Add"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={SECONDARY_BUTTON_CLASSES}
              onClick={closeDrawModal}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={attemptModal.open} onClose={closeAttemptModal} ariaLabelledBy="lotto-attempt-title">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 id="lotto-attempt-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {attemptModal.attemptId != null ? "Edit attempt" : "Add attempt"}
          </h2>
          <button
            type="button"
            className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
            onClick={closeAttemptModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitAttempt} className="flex flex-col gap-4">
          {attemptFormError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {attemptFormError}
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Your numbers</span>
            <input
              required
              type="text"
              inputMode="numeric"
              placeholder="3, 17, 29, 42, 58, 1"
              className={INPUT_CLASSES}
              value={attemptModal.numbersText}
              disabled={saving}
              onChange={(e) => setAttemptModal((m) => ({ ...m, numbersText: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">{NUMBERS_HELP}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={PRIMARY_BUTTON_CLASSES}>
              {saving ? "Saving…" : attemptModal.attemptId != null ? "Update" : "Add"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={SECONDARY_BUTTON_CLASSES}
              onClick={closeAttemptModal}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <FloatingAddButton hidden={anyModalOpen} onClick={openAddDraw} ariaLabel="Add lotto result" />
    </div>
  );
}
