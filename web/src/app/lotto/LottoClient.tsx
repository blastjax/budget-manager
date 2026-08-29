"use client";

import { useCallback, useEffect, useState } from "react";
import { FloatingAddButton } from "@/components/FloatingAddButton";
import { Modal } from "@/components/Modal";
import {
  createLottoAttempt,
  deleteLottoAttempt,
  deleteLottoDraw,
  getLottoDraws,
  setLottoAttemptHidden,
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

const DRAW_DATE_HELP = "MM/DD/YYYY (e.g. 8/28/2026)";

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

/** The stored "YYYY-MM-DD" -> "M/D/YYYY", for pre-filling the date field
 * when editing an existing draw. */
function isoToUsDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** Accepts a typed "MM/DD/YYYY" (e.g. 8/28/2026). */
function parseDrawDate(text: string): string {
  const trimmed = text.trim();
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

/** Moves the items matching `shouldBump` to the front, otherwise leaving the
 * list exactly as it was — a stable partition, not a sort, so items never
 * get reordered relative to their own kind. */
function bumpMatches<T>(items: T[], shouldBump: (item: T) => boolean): T[] {
  const bumped: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (shouldBump(item) ? bumped : rest).push(item);
  }
  return [...bumped, ...rest];
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
  // Hidden attempts are tucked out of view by default. This tracks which
  // draws currently have theirs revealed — per-draw, so one draw's hidden
  // attempts can be shown without exposing every other draw's too.
  const [shownHiddenDrawIds, setShownHiddenDrawIds] = useState<Set<number>>(new Set());

  const toggleCollapsed = (drawId: number) => {
    setCollapsedIds((s) => {
      const next = new Set(s);
      if (next.has(drawId)) next.delete(drawId);
      else next.add(drawId);
      return next;
    });
  };

  const toggleShowHiddenForDraw = (drawId: number) => {
    setShownHiddenDrawIds((s) => {
      const next = new Set(s);
      if (next.has(drawId)) next.delete(drawId);
      else next.add(drawId);
      return next;
    });
  };

  // A draw with no attempts has nothing to collapse, so it's never
  // collapsible — only draws with attempts participate in collapse state.
  const collapsibleDraws = draws.filter((d) => d.attempts.length > 0);

  const drawsWithHidden = draws.filter((d) => d.attempts.some((a) => a.hidden));
  const totalHiddenAttempts = draws.reduce(
    (sum, d) => sum + d.attempts.filter((a) => a.hidden).length,
    0,
  );
  const allHiddenShown =
    drawsWithHidden.length > 0 && drawsWithHidden.every((d) => shownHiddenDrawIds.has(d.draw.id));

  const toggleShowHiddenAll = () => {
    setShownHiddenDrawIds((s) => {
      const allShown = drawsWithHidden.every((d) => s.has(d.draw.id));
      return allShown ? new Set() : new Set(drawsWithHidden.map((d) => d.draw.id));
    });
  };

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
      drawDate: isoToUsDate(detail.draw.draw_date),
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

  /** Hides or unhides an attempt without deleting it — hidden attempts stay
   * in the data and reappear once "Show hidden" is switched on. */
  const onToggleAttemptHidden = async (drawId: number, attempt: LottoAttemptRow) => {
    setSaving(true);
    setError(null);
    try {
      const detail = await setLottoAttemptHidden(drawId, attempt.id, !attempt.hidden);
      upsertLocalDraw(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update attempt");
    } finally {
      setSaving(false);
    }
  };

  /** Hides or unhides every board play on a physical ticket in one go,
   * instead of one attempt at a time. Attempts already at the target state
   * are skipped. */
  const onToggleTicketHidden = async (
    drawId: number,
    items: { attempt: LottoAttemptRow }[],
    hidden: boolean,
  ) => {
    const targets = items.filter(({ attempt }) => attempt.hidden !== hidden);
    if (targets.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      let detail: LottoDrawDetail | null = null;
      for (const { attempt } of targets) {
        detail = await setLottoAttemptHidden(drawId, attempt.id, hidden);
      }
      if (detail) upsertLocalDraw(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update ticket");
    } finally {
      setSaving(false);
    }
  };

  /** The first unused ticket number for a draw, so a freshly-grouped pair
   * gets a ticket that doesn't collide with any existing one. */
  const nextTicketNumber = (attempts: LottoAttemptRow[]): number =>
    attempts.reduce((max, a) => (a.ticket != null && a.ticket > max ? a.ticket : max), 0) + 1;

  const setAttemptTicket = async (
    drawId: number,
    attempt: LottoAttemptRow,
    ticket: number | null,
  ) => {
    if (attempt.ticket === ticket) return;
    setSaving(true);
    setError(null);
    try {
      const detail = await updateLottoAttempt(drawId, attempt.id, attempt.numbers, ticket);
      upsertLocalDraw(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to group attempt");
    } finally {
      setSaving(false);
    }
  };

  /** The attempt named by a drop event's drag data, looked up in current state. */
  const attemptFromDragEvent = (
    drawId: number,
    e: React.DragEvent,
  ): LottoAttemptRow | null => {
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(id)) return null;
    return draws.find((d) => d.draw.id === drawId)?.attempts.find((a) => a.id === id) ?? null;
  };

  /** Dropping one attempt onto another groups them: if the target is
   * already on a ticket, the dragged attempt joins it; if neither is
   * grouped yet, a new ticket is minted for both. */
  const onDropOnAttempt = async (
    drawId: number,
    target: LottoAttemptRow,
    e: React.DragEvent,
  ) => {
    e.preventDefault();
    const dragged = attemptFromDragEvent(drawId, e);
    if (!dragged || dragged.id === target.id) return;
    let ticket = target.ticket;
    if (ticket == null) {
      const draw = draws.find((d) => d.draw.id === drawId);
      ticket = nextTicketNumber(draw?.attempts ?? []);
      await setAttemptTicket(drawId, target, ticket);
    }
    await setAttemptTicket(drawId, dragged, ticket);
  };

  /** Dropping an attempt directly onto a ticket cluster joins that ticket. */
  const onDropOnTicket = async (drawId: number, ticket: number, e: React.DragEvent) => {
    e.preventDefault();
    const dragged = attemptFromDragEvent(drawId, e);
    if (!dragged) return;
    await setAttemptTicket(drawId, dragged, ticket);
  };

  /** Dropping an attempt onto the ungrouped section pulls it out of its ticket. */
  const onDropToUngroup = async (drawId: number, e: React.DragEvent) => {
    e.preventDefault();
    const dragged = attemptFromDragEvent(drawId, e);
    if (!dragged) return;
    await setAttemptTicket(drawId, dragged, null);
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

      {error && (
        <div className={ERROR_ALERT_CLASSES} role="alert">
          {error}
        </div>
      )}

      {!loading && draws.length === 0 && (
        <p className={DASHED_EMPTY_CLASSES}>No results yet — add one to get started.</p>
      )}

      {(collapsibleDraws.length > 0 || totalHiddenAttempts > 0) && (
        <div className="flex justify-end gap-2">
          {totalHiddenAttempts > 0 && (
            <button
              type="button"
              className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1.5 text-xs sm:px-3 sm:text-sm`}
              onClick={toggleShowHiddenAll}
            >
              {allHiddenShown
                ? "Hide hidden attempts"
                : `Show hidden attempts (${totalHiddenAttempts})`}
            </button>
          )}
          {collapsibleDraws.length > 0 && (
            <button
              type="button"
              className={`${SECONDARY_BUTTON_CLASSES} px-2 py-1.5 text-xs sm:px-3 sm:text-sm`}
              onClick={toggleCollapseAll}
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5">
        {draws.map((detail) => {
          const hasResult = detail.draw.numbers.length === 6;
          const drawSet = new Set(detail.draw.numbers);
          // The card's own header counts every attempt, hidden or not — only
          // the list below it is filtered by "Show hidden".
          const totalAttempts = detail.attempts.length;
          const ticketCount = new Set(
            detail.attempts.flatMap((a) => (a.ticket != null ? [a.ticket] : [])),
          ).size;
          // Hidden attempts stay in the data (nothing is deleted) but drop
          // out of the normal view until this draw's "Show hidden" is
          // switched on.
          const showHiddenForDraw = shownHiddenDrawIds.has(detail.draw.id);
          const rawHiddenCount = detail.attempts.filter((a) => a.hidden).length;
          const visibleAttempts = showHiddenForDraw
            ? detail.attempts
            : detail.attempts.filter((a) => !a.hidden);
          const hasAttempts = totalAttempts > 0;
          const collapsed = hasAttempts && collapsedIds.has(detail.draw.id);
          // Without a result yet, there's nothing to match attempts against —
          // matchCount is a placeholder (-1) rather than a false "0/6 matched".
          // Order follows visibleAttempts as logged (the sequence on the
          // physical tickets) — see bumpMatches below for how strong matches
          // surface without disturbing that order.
          const attemptsByMatch = hasResult
            ? visibleAttempts.map((attempt) => ({
                attempt,
                matchCount: attempt.numbers.filter((n) => drawSet.has(n)).length,
              }))
            : visibleAttempts.map((attempt) => ({ attempt, matchCount: -1 }));
          // Always all six tiers, zero counts included, so the row of badges
          // lines up in the same place on every card instead of shifting
          // around based on which tiers that draw happened to hit. Counts
          // every attempt (hidden or not) — the breakdown is a summary of
          // the whole draw, not just what "Show hidden" currently reveals.
          const matchBreakdown =
            hasResult && totalAttempts > 0
              ? [1, 2, 3, 4, 5, 6].map((tier) => ({
                  tier,
                  count: detail.attempts.filter(
                    (a) => a.numbers.filter((n) => drawSet.has(n)).length === tier,
                  ).length,
                }))
              : [];

          // Cluster attempts by ticket — up to a handful of board plays on
          // one physical ticket share a ticket number, so they're grouped
          // together instead of scattered across a flat list. Clusters keep
          // the order the tickets were logged in (that sequence is already
          // right) — bumpMatches only lifts a 3/6-or-better ticket to the
          // top, without otherwise reshuffling anything. Ungrouped attempts
          // sit in their own section underneath (drag one onto a ticket, or
          // onto another ungrouped attempt, to group it).
          type AttemptCluster = {
            ticket: number;
            items: typeof attemptsByMatch;
            bestMatch: number;
            // True only when every item currently shown for this ticket is
            // hidden — with "Show hidden" off, a partly-hidden ticket only
            // shows its visible attempts, so this reads false until they're
            // revealed (there'd be nothing to "unhide" from this view yet).
            allHidden: boolean;
          };
          const byTicket = new Map<number, typeof attemptsByMatch>();
          const looseItems: typeof attemptsByMatch = [];
          for (const item of attemptsByMatch) {
            const ticket = item.attempt.ticket;
            if (ticket != null) {
              const arr = byTicket.get(ticket);
              if (arr) arr.push(item);
              else byTicket.set(ticket, [item]);
            } else {
              looseItems.push(item);
            }
          }
          const orderedLooseItems = bumpMatches(looseItems, (i) => i.matchCount >= 3);
          const ticketClusters: AttemptCluster[] = bumpMatches(
            Array.from(byTicket.entries()).map(([ticket, items]) => ({
              ticket,
              items,
              bestMatch: Math.max(...items.map((i) => i.matchCount)),
              allHidden: items.every((i) => i.attempt.hidden),
            })),
            (c) => c.bestMatch >= 3,
          );
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
              draggable
              title="Drag onto another attempt or ticket to group them"
              className={`flex cursor-grab flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950 ${
                attempt.hidden ? "opacity-50" : ""
              }`}
              onDragStart={(e) => {
                const el = e.target as HTMLElement | null;
                if (!el || el.closest("button")) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData("text/plain", String(attempt.id));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.stopPropagation();
                void onDropOnAttempt(detail.draw.id, attempt, e);
              }}
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
                {attempt.hidden && (
                  <span className="ml-1 rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                    Hidden
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                  onClick={() => openEditAttempt(detail.draw.id, attempt)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs transition hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                  onClick={() => void onToggleAttemptHidden(detail.draw.id, attempt)}
                >
                  {attempt.hidden ? "Unhide" : "Hide"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                  onClick={() => void onDeleteAttempt(detail.draw.id, attempt.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          );
          const matchBreakdownDisplay = matchBreakdown.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {matchBreakdown.map(({ tier, count }) => (
                <span
                  key={tier}
                  className={`rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 ${
                    count === 0 ? "opacity-40" : ""
                  }`}
                >
                  {tier}/6 &times;{count}
                </span>
              ))}
            </div>
          );
          return (
            <section key={detail.draw.id} className={CARD_CLASSES}>
              <div
                className={`group -m-1 flex flex-wrap items-start justify-between gap-3 rounded-lg p-1 transition-colors ${
                  hasAttempts ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : ""
                }`}
                role={hasAttempts ? "button" : undefined}
                tabIndex={hasAttempts ? 0 : undefined}
                aria-expanded={hasAttempts ? !collapsed : undefined}
                onClick={() => {
                  if (hasAttempts) toggleCollapsed(detail.draw.id);
                }}
                onKeyDown={(e) => {
                  if (!hasAttempts) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleCollapsed(detail.draw.id);
                  }
                }}
              >
                <div className="min-w-0">
                  <h2
                    className={`text-lg font-medium text-zinc-900 dark:text-zinc-50 ${
                      hasAttempts
                        ? "transition-colors group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                        : ""
                    }`}
                  >
                    {formatDate(detail.draw.draw_date)}
                    {collapsed && (
                      <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                        ({totalAttempts} attempt
                        {totalAttempts === 1 ? "" : "s"}
                        {ticketCount > 0
                          ? `, ${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`
                          : ""}
                        )
                      </span>
                    )}
                  </h2>
                  {drawNumbersDisplay}
                  {matchBreakdownDisplay}
                </div>
                <div
                  className="flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
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
                    className="rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40 sm:px-3 sm:text-sm"
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
                  {ticketCount > 0 && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ticketCount} ticket{ticketCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {rawHiddenCount > 0 && (
                    <button
                      type="button"
                      disabled={saving}
                      className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      onClick={() => toggleShowHiddenForDraw(detail.draw.id)}
                    >
                      {showHiddenForDraw
                        ? "Hide hidden"
                        : `Show hidden (${rawHiddenCount})`}
                    </button>
                  )}
                  {matchBreakdown.length > 0 && (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {matchBreakdown.map(({ tier, count }) => (
                        <span key={tier} className={count === 0 ? "opacity-40" : ""}>
                          {tier}/6 &times;{count}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  {ticketClusters.map((cluster) => (
                    <div
                      key={`ticket-${cluster.ticket}`}
                      className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => void onDropOnTicket(detail.draw.id, cluster.ticket, e)}
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
                        {cluster.allHidden && (
                          <span className="rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                            Hidden
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-normal transition hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                            onClick={() =>
                              void onToggleTicketHidden(
                                detail.draw.id,
                                cluster.items,
                                !cluster.allHidden,
                              )
                            }
                          >
                            {cluster.allHidden ? "Unhide ticket" : "Hide ticket"}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-normal transition hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                            onClick={() => openAddAttempt(detail.draw.id, cluster.ticket)}
                          >
                            + Add to this ticket
                          </button>
                        </div>
                      </div>
                      <ul className="flex flex-col gap-2">
                        {cluster.items.map(({ attempt, matchCount }) =>
                          renderAttemptRow(attempt, matchCount),
                        )}
                      </ul>
                    </div>
                  ))}
                  {orderedLooseItems.length > 0 && (
                    <div
                      className={
                        ticketClusters.length > 0
                          ? "rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
                          : ""
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => void onDropToUngroup(detail.draw.id, e)}
                    >
                      {ticketClusters.length > 0 && (
                        <div className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          Ungrouped — drag onto a ticket (or another attempt) to group
                        </div>
                      )}
                      <ul className="flex flex-col gap-2">
                        {orderedLooseItems.map(({ attempt, matchCount }) =>
                          renderAttemptRow(attempt, matchCount),
                        )}
                      </ul>
                    </div>
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
            className="rounded border border-zinc-200 px-2 py-1 text-xs transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
            className="rounded border border-zinc-200 px-2 py-1 text-xs transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
            className="rounded border border-zinc-200 px-2 py-1 text-xs transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
