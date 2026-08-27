"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FloatingAddButton } from "@/components/FloatingAddButton";
import { Modal } from "@/components/Modal";
import {
  createLottoAttempt,
  deleteLottoAttempt,
  deleteLottoDraw,
  getLottoDraws,
  setLottoDraw,
  updateLottoAttempt,
  updateLottoDraw,
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

const NUMBERS_HELP =
  "6 unique numbers, 1-58 — separate with commas, spaces, or dashes (e.g. 3, 17, 29, 42, 58, 1 or 03-17-29-42-58-01)";
const NUMBERS_PLACEHOLDER = "3, 17, 29, 42, 58, 1  or  03-17-29-42-58-01";

const DRAW_DATE_HELP = "YYYY-MM-DD or M/D/YYYY (e.g. 2026-07-07 or 7/7/2026)";
const DRAW_DATE_PLACEHOLDER = "2026-07-07  or  7/7/2026";

/** Turns a validated y/m/d into "YYYY-MM-DD", rejecting dates like Feb 30. */
function toIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Enter a valid date.");
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Accepts "YYYY-MM-DD" (what a native date picker produces) as well as a
 * typed "M/D/YYYY" (e.g. 7/7/2026). */
function parseDrawDate(text: string): string {
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return toIsoDate(Number(y), Number(m), Number(d));
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const [, m, d, y] = us;
    return toIsoDate(Number(y), Number(m), Number(d));
  }
  throw new Error(`Enter a date as ${DRAW_DATE_HELP}.`);
}

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
  variant?: "neutral" | "result" | "match" | "miss" | "pick";
}) {
  const styles: Record<string, string> = {
    neutral:
      "border-zinc-300 bg-white text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100",
    result:
      "border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-100",
    match:
      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-500 dark:bg-emerald-600",
    miss: "border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500",
    pick: "border-orange-500 bg-orange-500 text-white dark:border-orange-500 dark:bg-orange-600",
  };
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums ${styles[variant]}`}
    >
      {n}
    </span>
  );
}

type DrawModalState = {
  open: boolean;
  drawId: number | null;
  drawDate: string;
  numbersText: string;
  isEdit: boolean;
};
type AttemptModalState = {
  open: boolean;
  drawId: number | null;
  attemptId: number | null;
  numbersText: string;
};

const emptyDrawModal: DrawModalState = {
  open: false,
  drawId: null,
  drawDate: "",
  numbersText: "",
  isEdit: false,
};
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

  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  const toggleCollapsed = (drawId: number) => {
    setCollapsedIds((s) => {
      const next = new Set(s);
      if (next.has(drawId)) next.delete(drawId);
      else next.add(drawId);
      return next;
    });
  };

  const allCollapsed = draws.length > 0 && draws.every((d) => collapsedIds.has(d.draw.id));

  const toggleCollapseAll = () => {
    setCollapsedIds((s) => {
      const allAreCollapsed = draws.length > 0 && draws.every((d) => s.has(d.draw.id));
      return allAreCollapsed ? new Set() : new Set(draws.map((d) => d.draw.id));
    });
  };

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
      const out = i === -1 ? [detail, ...ds] : ds.map((d, idx) => (idx === i ? detail : d));
      return out.sort((a, b) => b.draw.draw_date.localeCompare(a.draw.draw_date));
    });
  };

  const openAddDraw = () => {
    setDrawFormError(null);
    setDrawModal({ open: true, drawId: null, drawDate: "", numbersText: "", isEdit: false });
  };

  const openEditDraw = (detail: LottoDrawDetail) => {
    setDrawFormError(null);
    setDrawModal({
      open: true,
      drawId: detail.draw.id,
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
      setDrawFormError("Enter a date.");
      return;
    }
    let drawDate: string;
    let numbers: number[];
    try {
      drawDate = parseDrawDate(drawModal.drawDate);
      numbers = parseNumbers(drawModal.numbersText);
    } catch (err) {
      setDrawFormError(err instanceof Error ? err.message : "Invalid input");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const detail =
        drawModal.isEdit && drawModal.drawId != null
          ? await updateLottoDraw(drawModal.drawId, drawDate, numbers)
          : await setLottoDraw(drawDate, numbers);
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

  // Naive "next draw" pick: the 6 numbers that have come up most often across
  // every past result, ties broken by number. Just a frequency read of
  // history — not a real prediction of a random draw.
  const nextDrawPick = useMemo(() => {
    if (draws.length === 0) return [];
    const freq = new Map<number, number>();
    for (const { draw } of draws) {
      for (const n of draw.numbers) {
        freq.set(n, (freq.get(n) ?? 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 6)
      .map(([n]) => n)
      .sort((a, b) => a - b);
  }, [draws]);

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

      {nextDrawPick.length > 0 && (
        <section className="rounded-xl border border-orange-300 bg-orange-50 p-5 shadow-sm dark:border-orange-800 dark:bg-orange-950/30 sm:p-6">
          <h2 className="text-sm font-semibold text-orange-900 dark:text-orange-200">
            Next draw pick
          </h2>
          <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-300/80">
            The 6 numbers that have come up most often across past results — just a
            frequency read of history, not a real prediction.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {nextDrawPick.map((n) => (
              <NumberBall key={n} n={n} variant="pick" />
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className={ERROR_ALERT_CLASSES} role="alert">
          {error}
        </div>
      )}

      {!loading && draws.length === 0 && (
        <p className={DASHED_EMPTY_CLASSES}>No results yet — add one to get started.</p>
      )}

      {draws.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1.5 text-xs sm:px-3 sm:text-sm`}
            onClick={toggleCollapseAll}
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {draws.map((detail) => {
          const drawSet = new Set(detail.draw.numbers);
          const collapsed = collapsedIds.has(detail.draw.id);
          const attemptsByMatch = detail.attempts
            .map((attempt) => ({
              attempt,
              matchCount: attempt.numbers.filter((n) => drawSet.has(n)).length,
            }))
            .sort((a, b) => b.matchCount - a.matchCount);
          const matchBreakdown = [3, 4, 5, 6]
            .map((tier) => ({
              tier,
              count: attemptsByMatch.filter((a) => a.matchCount === tier).length,
            }))
            .filter((b) => b.count > 0);
          const attemptGroups = attemptsByMatch.reduce<
            { matchCount: number; items: typeof attemptsByMatch }[]
          >((groups, item) => {
            const last = groups[groups.length - 1];
            if (last && last.matchCount === item.matchCount) {
              last.items.push(item);
            } else {
              groups.push({ matchCount: item.matchCount, items: [item] });
            }
            return groups;
          }, []);
          return (
            <section key={detail.draw.id} className={CARD_CLASSES}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 items-start gap-2 text-left"
                  aria-expanded={!collapsed}
                  onClick={() => toggleCollapsed(detail.draw.id)}
                >
                  <span
                    className={`mt-1.5 inline-block shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${
                      collapsed ? "-rotate-90" : ""
                    }`}
                    aria-hidden
                  >
                    ▾
                  </span>
                  <div>
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                      {formatDate(detail.draw.draw_date)}
                      {collapsed && (
                        <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                          ({detail.attempts.length} attempt
                          {detail.attempts.length === 1 ? "" : "s"})
                        </span>
                      )}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {detail.draw.numbers.map((n) => (
                        <NumberBall key={n} n={n} variant="result" />
                      ))}
                    </div>
                  </div>
                </button>
                {matchBreakdown.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {matchBreakdown.map(({ tier, count }) => (
                      <span
                        key={tier}
                        className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                      >
                        {tier}/6 &times;{count}
                      </span>
                    ))}
                  </div>
                )}
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

              {!collapsed && (
              <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Attempts
                  </h3>
                  {matchBreakdown.length > 0 && (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {matchBreakdown.map(({ tier, count }) => (
                        <span key={tier}>
                          {tier}/6 &times;{count}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                {detail.attempts.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-500">
                    No attempts logged for this date yet.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-3">
                    {attemptGroups.map((group) => (
                      <div
                        key={group.matchCount}
                        className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                      >
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <span>{group.matchCount}/6 matched</span>
                          <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                            {group.items.length}
                          </span>
                        </div>
                        <ul className="flex flex-col gap-2">
                          {group.items.map(({ attempt, matchCount }) => (
                            <li
                              key={attempt.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                {attempt.numbers.map((n) => (
                                  <NumberBall
                                    key={n}
                                    n={n}
                                    variant={drawSet.has(n) ? "match" : "miss"}
                                  />
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
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  disabled={saving}
                  className={`${SECONDARY_BUTTON_CLASSES} mt-3 px-2 py-1 text-xs`}
                  onClick={() => openAddAttempt(detail.draw.id)}
                >
                  + Add attempt
                </button>
              </div>
              )}
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
              type="text"
              placeholder={DRAW_DATE_PLACEHOLDER}
              className={INPUT_CLASSES}
              value={drawModal.drawDate}
              disabled={saving}
              onChange={(e) => setDrawModal((m) => ({ ...m, drawDate: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">{DRAW_DATE_HELP}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Winning numbers</span>
            <input
              required
              type="text"
              placeholder={NUMBERS_PLACEHOLDER}
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
              placeholder={NUMBERS_PLACEHOLDER}
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
