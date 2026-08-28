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

const DRAW_DATE_HELP = "YYYY-MM-DD or M/D/YYYY (e.g. 2026-07-07 or 7/7/2026)";

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

/** Like `parseNumbers`, but blank input means "no result yet" rather than an
 * error — a draw can be logged by date alone before its numbers are known. */
function parseOptionalNumbers(text: string): number[] | null {
  if (text.trim() === "") return null;
  return parseNumbers(text);
}

/** A blank line's worth of numbers-lines grouped together — one physical
 * ticket, holding each of its board plays (attempts). */
type TicketBlock = { ticket: number | null; attempts: number[][] };

const TICKET_HEADER_RE = /^ticket\s*#?\s*(\d+)\s*:?$/i;

function parseTicketBlock(lines: string[], blockIndex: number): TicketBlock {
  let ticket: number | null = null;
  let numberLines = lines;
  const header = TICKET_HEADER_RE.exec(lines[0].trim());
  if (header) {
    ticket = Number(header[1]);
    numberLines = lines.slice(1);
  }
  if (numberLines.length === 0) {
    throw new Error(`Ticket ${blockIndex + 1} has no numbers under it.`);
  }
  const attempts = numberLines.map((line, i) => {
    try {
      return parseNumbers(line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid numbers";
      throw new Error(`Ticket ${blockIndex + 1}, line ${i + 1}: ${msg}`);
    }
  });
  return { ticket, attempts };
}

/** A .txt upload is one or more tickets, each a blank-line-separated group of
 * lines — every line under a ticket is one attempt's 6 numbers. A ticket's
 * first line may optionally read "ticket N" to pin its number explicitly;
 * otherwise tickets are numbered in file order. */
function parseTicketsFile(text: string): TicketBlock[] {
  const rawLines = text.split(/\r?\n/);
  const blocks: TicketBlock[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      blocks.push(parseTicketBlock(current, blocks.length));
      current = [];
    }
  };
  for (const line of rawLines) {
    if (line.trim() === "") {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  if (blocks.length === 0) {
    throw new Error("That file doesn't have any numbers in it.");
  }
  return blocks;
}

/** Blank means "not part of a ticket group". */
function parseOptionalTicket(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Ticket # must be a positive whole number.");
  }
  return n;
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
  ticketText: string;
};
type UploadModalState = {
  open: boolean;
  drawDate: string;
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
  ticketText: "",
};
const emptyUploadModal: UploadModalState = { open: false, drawDate: "" };

export default function LottoClient() {
  const [draws, setDraws] = useState<LottoDrawDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [predictionsCollapsed, setPredictionsCollapsed] = useState(true);

  const toggleCollapsed = (drawId: number) => {
    setCollapsedIds((s) => {
      const next = new Set(s);
      if (next.has(drawId)) next.delete(drawId);
      else next.add(drawId);
      return next;
    });
  };

  // A draw with no attempts has nothing to hide, so it's never collapsible —
  // only draws with attempts participate in collapse state.
  const collapsibleDraws = draws.filter((d) => d.attempts.length > 0);

  const allCollapsed =
    collapsibleDraws.length > 0 && collapsibleDraws.every((d) => collapsedIds.has(d.draw.id));

  const toggleCollapseAll = () => {
    setCollapsedIds((s) => {
      const allAreCollapsed =
        collapsibleDraws.length > 0 && collapsibleDraws.every((d) => s.has(d.draw.id));
      return allAreCollapsed ? new Set() : new Set(collapsibleDraws.map((d) => d.draw.id));
    });
  };

  const [drawModal, setDrawModal] = useState<DrawModalState>(emptyDrawModal);
  const [drawFormError, setDrawFormError] = useState<string | null>(null);

  const [attemptModal, setAttemptModal] = useState<AttemptModalState>(emptyAttemptModal);
  const [attemptFormError, setAttemptFormError] = useState<string | null>(null);

  const [uploadModal, setUploadModal] = useState<UploadModalState>(emptyUploadModal);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFormError, setUploadFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getLottoDraws(500);
      setDraws(r.draws);
      setCollapsedIds(
        new Set(r.draws.filter((d) => d.attempts.length > 0).map((d) => d.draw.id)),
      );
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
    let numbers: number[] | null;
    try {
      drawDate = parseDrawDate(drawModal.drawDate);
      numbers = parseOptionalNumbers(drawModal.numbersText);
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

  const openAddAttempt = (drawId: number, ticket: number | null = null) => {
    setAttemptFormError(null);
    setAttemptModal({
      open: true,
      drawId,
      attemptId: null,
      numbersText: "",
      ticketText: ticket != null ? String(ticket) : "",
    });
  };

  const openEditAttempt = (drawId: number, attempt: LottoAttemptRow) => {
    setAttemptFormError(null);
    setAttemptModal({
      open: true,
      drawId,
      attemptId: attempt.id,
      numbersText: numbersToText(attempt.numbers),
      ticketText: attempt.ticket != null ? String(attempt.ticket) : "",
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
    let ticket: number | null;
    try {
      numbers = parseNumbers(attemptModal.numbersText);
      ticket = parseOptionalTicket(attemptModal.ticketText);
    } catch (err) {
      setAttemptFormError(err instanceof Error ? err.message : "Invalid numbers");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const detail =
        attemptModal.attemptId != null
          ? await updateLottoAttempt(
              attemptModal.drawId,
              attemptModal.attemptId,
              numbers,
              ticket,
            )
          : await createLottoAttempt(attemptModal.drawId, numbers, ticket);
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

  const openUpload = () => {
    setUploadFormError(null);
    setUploadFile(null);
    setUploadModal({ open: true, drawDate: "" });
  };

  const closeUploadModal = () => {
    setUploadModal(emptyUploadModal);
    setUploadFile(null);
    setUploadFormError(null);
  };

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadFormError(null);
    if (!uploadModal.drawDate) {
      setUploadFormError("Enter a date.");
      return;
    }
    if (!uploadFile) {
      setUploadFormError("Choose a .txt file.");
      return;
    }
    let drawDate: string;
    let blocks: TicketBlock[];
    try {
      drawDate = parseDrawDate(uploadModal.drawDate);
      blocks = parseTicketsFile(await uploadFile.text());
    } catch (err) {
      setUploadFormError(err instanceof Error ? err.message : "Invalid input");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const existing = draws.find((d) => d.draw.draw_date === drawDate);
      let drawId: number;
      if (existing) {
        drawId = existing.draw.id;
      } else {
        const created = await setLottoDraw(drawDate, null);
        drawId = created.draw.id;
        upsertLocalDraw(created);
      }
      // Tickets without an explicit "ticket N" header are numbered after
      // whatever's already on this draw (so a second upload doesn't collide
      // with tickets from the first), in file order.
      const priorMaxTicket = (existing?.attempts ?? []).reduce(
        (max, a) => (a.ticket != null && a.ticket > max ? a.ticket : max),
        0,
      );
      let nextAutoTicket = priorMaxTicket + 1;
      let detail: LottoDrawDetail | null = null;
      for (const block of blocks) {
        const ticket = block.ticket ?? nextAutoTicket;
        nextAutoTicket = Math.max(nextAutoTicket, ticket + 1);
        for (const numbers of block.attempts) {
          detail = await createLottoAttempt(drawId, numbers, ticket);
        }
      }
      if (detail) upsertLocalDraw(detail);
      closeUploadModal();
    } catch (err) {
      setUploadFormError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  const anyModalOpen = drawModal.open || attemptModal.open || uploadModal.open;

  // A few naive "next draw" picks, each a different frequency read of past
  // results — not real predictions of a random draw, just different lenses
  // on the history logged so far.
  const drawPredictions = useMemo<
    { key: string; title: string; reasoning: string; numbers: number[] }[]
  >(() => {
    const resultDraws = draws.filter((d) => d.draw.numbers.length === 6);
    if (resultDraws.length === 0) return [];

    const pick = (
      entries: [number, number][],
      order: "top" | "bottom",
    ): number[] =>
      entries
        .slice()
        .sort((a, b) =>
          order === "top" ? b[1] - a[1] || a[0] - b[0] : a[1] - b[1] || a[0] - b[0],
        )
        .slice(0, 6)
        .map(([n]) => n)
        .sort((a, b) => a - b);

    const freqOver = (subset: LottoDrawDetail[]): [number, number][] => {
      const freq = new Map<number, number>();
      for (let n = 1; n <= 58; n++) freq.set(n, 0);
      for (const { draw } of subset) {
        for (const n of draw.numbers) {
          freq.set(n, (freq.get(n) ?? 0) + 1);
        }
      }
      return Array.from(freq.entries());
    };

    const allFreq = freqOver(resultDraws);

    const RECENT_WINDOW = 10;
    const recentDraws = resultDraws.slice(0, RECENT_WINDOW); // newest-first
    const recentFreq = freqOver(recentDraws);

    // One number per equal slice of the 1-58 range, favoring the most
    // frequent number within each slice — spreads the pick across the full
    // range instead of letting it cluster in one neighborhood.
    const pickBalanced = (entries: [number, number][]): number[] => {
      const byNumber = new Map(entries);
      const bucketCount = 6;
      const bucketSize = Math.ceil(58 / bucketCount);
      const picks: number[] = [];
      for (let b = 0; b < bucketCount; b++) {
        const start = b * bucketSize + 1;
        const end = Math.min(58, start + bucketSize - 1);
        let best = start;
        for (let n = start; n <= end; n++) {
          if ((byNumber.get(n) ?? 0) > (byNumber.get(best) ?? 0)) best = n;
        }
        picks.push(best);
      }
      return picks.sort((a, b) => a - b);
    };

    const plural = (n: number) => (n === 1 ? "result" : "results");

    return [
      {
        key: "hot",
        title: "Hot numbers",
        reasoning: `Drawn most often across all ${resultDraws.length} logged ${plural(resultDraws.length)} — the theory that a number "on a streak" keeps coming up.`,
        numbers: pick(allFreq, "top"),
      },
      {
        key: "cold",
        title: "Cold numbers",
        reasoning: `Drawn least often (or never) across all ${resultDraws.length} logged ${plural(resultDraws.length)} — the "overdue" theory, that a number absent this long is due to appear.`,
        numbers: pick(allFreq, "bottom"),
      },
      {
        key: "recent",
        title: "Recent trend",
        reasoning: `Drawn most often in just the last ${recentDraws.length} logged ${plural(recentDraws.length)} — numbers trending lately rather than over all-time history.`,
        numbers: pick(recentFreq, "top"),
      },
      {
        key: "balanced",
        title: "Balanced spread",
        reasoning:
          "One number from each equal slice of the 1-58 range (1-10, 11-20, …), favoring whichever number in that slice has come up most — spreads the pick across the full range instead of clustering.",
        numbers: pickBalanced(allFreq),
      },
    ];
  }, [draws]);

  return (
    <div className="relative mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 px-4 pb-28 py-8 sm:px-6">
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Lotto
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Enter each date&apos;s result, then log your attempts underneath it — matching
              numbers turn green.
            </p>
          </div>
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASSES} shrink-0 px-3 py-1.5 text-sm`}
            onClick={openUpload}
          >
            Upload from txt
          </button>
        </div>
      </header>

      {drawPredictions.length > 0 && (
        <section className="rounded-xl border border-orange-300 bg-orange-50 p-5 shadow-sm dark:border-orange-800 dark:bg-orange-950/30 sm:p-6">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-2 text-left"
            aria-expanded={!predictionsCollapsed}
            onClick={() => setPredictionsCollapsed((c) => !c)}
          >
            <div>
              <h2 className="text-sm font-semibold text-orange-900 dark:text-orange-200">
                Next draw picks
                {predictionsCollapsed && (
                  <span className="ml-2 text-xs font-normal text-orange-800/70 dark:text-orange-300/70">
                    ({drawPredictions.length})
                  </span>
                )}
              </h2>
              <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-300/80">
                A few different frequency reads of past results — not real predictions of
                a random draw.
              </p>
            </div>
            <span
              className={`mt-1 inline-block shrink-0 text-orange-500 transition-transform dark:text-orange-400 ${
                predictionsCollapsed ? "-rotate-90" : ""
              }`}
              aria-hidden
            >
              ▾
            </span>
          </button>
          {!predictionsCollapsed && (
            <div className="mt-4 flex flex-col gap-4">
              {drawPredictions.map((prediction, i) => (
                <div
                  key={prediction.key}
                  className={
                    i > 0 ? "border-t border-orange-200 pt-4 dark:border-orange-900" : ""
                  }
                >
                  <h3 className="text-sm font-medium text-orange-900 dark:text-orange-200">
                    {prediction.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-orange-800/80 dark:text-orange-300/80">
                    {prediction.reasoning}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {prediction.numbers.map((n) => (
                      <NumberBall key={n} n={n} variant="pick" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
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

      {collapsibleDraws.length > 0 && (
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
          const hasResult = detail.draw.numbers.length === 6;
          const drawSet = new Set(detail.draw.numbers);
          const hasAttempts = detail.attempts.length > 0;
          const collapsed = hasAttempts && collapsedIds.has(detail.draw.id);
          // Without a result yet, there's nothing to match attempts against —
          // matchCount is a placeholder (-1) rather than a false "0/6 matched".
          const attemptsByMatch = hasResult
            ? detail.attempts
                .map((attempt) => ({
                  attempt,
                  matchCount: attempt.numbers.filter((n) => drawSet.has(n)).length,
                }))
                .sort((a, b) => b.matchCount - a.matchCount)
            : detail.attempts.map((attempt) => ({ attempt, matchCount: -1 }));
          const matchBreakdown = hasResult
            ? [3, 4, 5, 6]
                .map((tier) => ({
                  tier,
                  count: attemptsByMatch.filter((a) => a.matchCount === tier).length,
                }))
                .filter((b) => b.count > 0)
            : [];

          // Cluster attempts by ticket — up to a handful of board plays on
          // one physical ticket share a ticket number, so they're grouped
          // together instead of scattered across a flat list; ungrouped
          // attempts stand alone. Clusters are ordered by their best match
          // (6/6 first), ticket number breaking ties, ungrouped attempts
          // sinking to the bottom of a tie.
          type AttemptCluster = {
            ticket: number | null;
            items: typeof attemptsByMatch;
            bestMatch: number;
          };
          const byTicket = new Map<number, typeof attemptsByMatch>();
          const loose: typeof attemptsByMatch = [];
          for (const item of attemptsByMatch) {
            const ticket = item.attempt.ticket;
            if (ticket != null) {
              const arr = byTicket.get(ticket);
              if (arr) arr.push(item);
              else byTicket.set(ticket, [item]);
            } else {
              loose.push(item);
            }
          }
          const attemptClusters: AttemptCluster[] = [
            ...Array.from(byTicket.entries()).map(([ticket, items]) => ({
              ticket,
              items: items.slice().sort((a, b) => b.matchCount - a.matchCount),
              bestMatch: Math.max(...items.map((i) => i.matchCount)),
            })),
            ...loose.map((item) => ({
              ticket: null,
              items: [item],
              bestMatch: item.matchCount,
            })),
          ].sort((a, b) => {
            if (b.bestMatch !== a.bestMatch) return b.bestMatch - a.bestMatch;
            if (a.ticket == null) return 1;
            if (b.ticket == null) return -1;
            return a.ticket - b.ticket;
          });
          const drawNumbersDisplay = hasResult ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {detail.draw.numbers.map((n) => (
                <NumberBall key={n} n={n} variant="result" />
              ))}
            </div>
          ) : (
            <span className="mt-2 inline-block rounded-full border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Result not in yet
            </span>
          );
          const renderAttemptRow = (attempt: LottoAttemptRow, matchCount: number) => (
            <li
              key={attempt.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {attempt.numbers.map((n) => (
                  <NumberBall
                    key={n}
                    n={n}
                    variant={hasResult ? (drawSet.has(n) ? "match" : "miss") : "neutral"}
                  />
                ))}
                <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {hasResult ? `${matchCount}/6 matched` : "Awaiting result"}
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
          return (
            <section key={detail.draw.id} className={CARD_CLASSES}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                {hasAttempts ? (
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
                      {drawNumbersDisplay}
                    </div>
                  </button>
                ) : (
                  <div className="flex min-w-0 items-start gap-2">
                    <div>
                      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                        {formatDate(detail.draw.draw_date)}
                      </h2>
                      {drawNumbersDisplay}
                    </div>
                  </div>
                )}
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
                    onClick={() => openAddAttempt(detail.draw.id)}
                  >
                    + Add attempt
                  </button>
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

              {!collapsed && hasAttempts && (
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

                <div className="mt-3 flex flex-col gap-3">
                  {attemptClusters.map((cluster) =>
                    cluster.ticket != null ? (
                      <div
                        key={`ticket-${cluster.ticket}`}
                        className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                            Ticket {cluster.ticket}
                          </span>
                          {hasResult && (
                            <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                              best {cluster.bestMatch}/6
                            </span>
                          )}
                          <span>
                            {cluster.items.length} attempt{cluster.items.length === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            disabled={saving}
                            className="ml-auto rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] font-normal dark:border-zinc-600"
                            onClick={() => openAddAttempt(detail.draw.id, cluster.ticket)}
                          >
                            + Add to this ticket
                          </button>
                        </div>
                        <ul className="flex flex-col gap-2">
                          {cluster.items.map(({ attempt, matchCount }) =>
                            renderAttemptRow(attempt, matchCount),
                          )}
                        </ul>
                      </div>
                    ) : (
                      <ul key={`loose-${cluster.items[0].attempt.id}`} className="flex flex-col gap-2">
                        {cluster.items.map(({ attempt, matchCount }) =>
                          renderAttemptRow(attempt, matchCount),
                        )}
                      </ul>
                    ),
                  )}
                </div>

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
              className={INPUT_CLASSES}
              value={drawModal.drawDate}
              disabled={saving}
              onChange={(e) => setDrawModal((m) => ({ ...m, drawDate: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">{DRAW_DATE_HELP}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Winning numbers <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <input
              type="text"
              className={INPUT_CLASSES}
              value={drawModal.numbersText}
              disabled={saving}
              onChange={(e) => setDrawModal((m) => ({ ...m, numbersText: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">
              {NUMBERS_HELP} — leave blank if the draw hasn&apos;t happened yet; fill it in
              once the result is announced.
            </span>
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
              className={INPUT_CLASSES}
              value={attemptModal.numbersText}
              disabled={saving}
              onChange={(e) => setAttemptModal((m) => ({ ...m, numbersText: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">{NUMBERS_HELP}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Ticket # <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <input
              type="text"
              inputMode="numeric"
              className={INPUT_CLASSES}
              value={attemptModal.ticketText}
              disabled={saving}
              onChange={(e) => setAttemptModal((m) => ({ ...m, ticketText: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">
              Groups this with the other attempts on the same physical ticket, so they
              cluster together — leave blank if it isn&apos;t part of a ticket.
            </span>
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

      <Modal open={uploadModal.open} onClose={closeUploadModal} ariaLabelledBy="lotto-upload-title">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 id="lotto-upload-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Upload from txt
          </h2>
          <button
            type="button"
            className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
            onClick={closeUploadModal}
          >
            Close
          </button>
        </div>
        <form onSubmit={submitUpload} className="flex flex-col gap-4">
          {uploadFormError && (
            <div className={ERROR_ALERT_CLASSES} role="alert">
              {uploadFormError}
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Draw date</span>
            <input
              required
              type="text"
              className={INPUT_CLASSES}
              value={uploadModal.drawDate}
              disabled={saving}
              onChange={(e) => setUploadModal((m) => ({ ...m, drawDate: e.target.value }))}
            />
            <span className="text-xs text-zinc-500">{DRAW_DATE_HELP}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Text file</span>
            <input
              required
              type="file"
              accept=".txt,text/plain"
              disabled={saving}
              className="text-sm text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium file:text-zinc-700 dark:text-zinc-300 dark:file:border-zinc-600 dark:file:bg-zinc-900 dark:file:text-zinc-200"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
            <span className="text-xs text-zinc-500">
              6 numbers per line (e.g. &quot;01 02 34 37 52 57&quot;) — a blank line starts a
              new ticket, so each group of lines becomes one ticket&apos;s attempts against
              the draw date above. A group&apos;s first line may optionally read
              &quot;ticket N&quot; to pin its number; otherwise tickets are numbered in
              file order.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={PRIMARY_BUTTON_CLASSES}>
              {saving ? "Uploading…" : "Upload"}
            </button>
            <button
              type="button"
              disabled={saving}
              className={SECONDARY_BUTTON_CLASSES}
              onClick={closeUploadModal}
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
