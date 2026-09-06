"use client";

import { useEffect, useState, type DragEvent } from "react";
import {
  createCompany,
  deleteCompany,
  getCompanies,
  reorderCompanies,
  updateCompany,
  type CompanyRow,
} from "@/lib/api";
import {
  CARD_CLASSES,
  DASHED_EMPTY_CLASSES,
  DELETE_BUTTON_CLASSES,
  EDIT_BUTTON_CLASSES,
  ERROR_ALERT_CLASSES,
  INPUT_CLASSES,
  LOADING_TEXT_CLASSES,
  PRIMARY_BUTTON_CLASSES,
  SECONDARY_BUTTON_CLASSES,
} from "@/lib/ui";

export function CompaniesSettingsPanel() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    getCompanies()
      .then((res) => setCompanies(res.companies))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : "Failed to load companies."),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!infoMsg) return;
    const t = window.setTimeout(() => setInfoMsg(null), 2800);
    return () => window.clearTimeout(t);
  }, [infoMsg]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      setAddError("Enter a company name.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await createCompany(name);
      setNewName("");
      setInfoMsg(`Added "${name}".`);
      load();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add company.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(company: CompanyRow) {
    setEditingId(company.id);
    setEditName(company.name);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(companyId: number) {
    const name = editName.trim();
    if (!name) {
      setEditError("Company name can't be blank.");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      await updateCompany(companyId, name);
      setEditingId(null);
      setInfoMsg("Company updated.");
      load();
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : "Failed to update company.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(company: CompanyRow) {
    if (!confirm(`Delete "${company.name}"?`)) return;
    try {
      await deleteCompany(company.id);
      setInfoMsg(`Deleted "${company.name}".`);
      load();
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Failed to delete company.");
    }
  }

  function handleCardDragStart(e: DragEvent<HTMLLIElement>, company: CompanyRow) {
    const el = e.target as HTMLElement | null;
    if (el?.closest("input, textarea, button, select, option")) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", String(company.id));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleCardDragOver(e: DragEvent<HTMLLIElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  /** Reorders locally right away, then persists — reverting on failure so the
   * list never quietly disagrees with the sidebar for long. */
  async function handleCardDrop(e: DragEvent<HTMLLIElement>, onto: CompanyRow) {
    e.preventDefault();
    const fromId = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(fromId) || fromId === onto.id) return;

    const previous = companies;
    const next = [...companies];
    const from = next.findIndex((c) => c.id === fromId);
    const to = next.findIndex((c) => c.id === onto.id);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCompanies(next);
    setReorderError(null);

    try {
      const res = await reorderCompanies(next.map((c) => c.id));
      setCompanies(res.companies);
    } catch (e: unknown) {
      setCompanies(previous);
      setReorderError(e instanceof Error ? e.message : "Failed to save the new order.");
    }
  }

  return (
    <section className={CARD_CLASSES}>
      <h2 className="text-lg font-medium text-ink">Companies</h2>
      <p className="mt-1 text-sm text-ink-2">
        Add or manage the companies payslips can be tagged under. Renaming or
        deleting here doesn&apos;t change the company already stored on
        existing payslips.
      </p>

      <div className="mt-6">
        {loading ? (
          <p className={LOADING_TEXT_CLASSES}>Loading companies…</p>
        ) : loadError ? (
          <div className={ERROR_ALERT_CLASSES}>{loadError}</div>
        ) : companies.length === 0 ? (
          <div className={DASHED_EMPTY_CLASSES}>No companies yet.</div>
        ) : (
          <>
            {reorderError && (
              <div className={`mb-3 ${ERROR_ALERT_CLASSES}`}>{reorderError}</div>
            )}
            <ul className="divide-y divide-zinc-200 rounded-lg border border-line dark:divide-zinc-900">
              {companies.map((company) => (
                <li
                  key={company.id}
                  className="cursor-grab p-4 active:cursor-grabbing"
                  title="Drag to reorder"
                  draggable
                  onDragStart={(e) => handleCardDragStart(e, company)}
                  onDragOver={handleCardDragOver}
                  onDrop={(e) => void handleCardDrop(e, company)}
                >
                {editingId === company.id ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-ink-2">
                        Name
                      </label>
                      <input
                        type="text"
                        className={INPUT_CLASSES}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    {editError && <div className={ERROR_ALERT_CLASSES}>{editError}</div>}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={PRIMARY_BUTTON_CLASSES}
                        disabled={savingEdit}
                        onClick={() => handleSaveEdit(company.id)}
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className={SECONDARY_BUTTON_CLASSES}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">{company.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={EDIT_BUTTON_CLASSES}
                        onClick={() => startEdit(company)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={DELETE_BUTTON_CLASSES}
                        onClick={() => handleDelete(company)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <fieldset className="mt-8 rounded-lg border border-line bg-zinc-50/80 px-4 py-4 dark:bg-zinc-900/40">
        <legend className="px-1 text-sm font-medium text-ink">
          Add a company
        </legend>
        <div className="mt-4 flex flex-col gap-1 sm:max-w-sm">
          <label className="text-xs font-medium text-ink-2">Name</label>
          <input
            type="text"
            className={INPUT_CLASSES}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoComplete="off"
          />
        </div>
        {addError && <div className={`mt-3 ${ERROR_ALERT_CLASSES}`}>{addError}</div>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASSES}
            disabled={adding}
            onClick={handleAdd}
          >
            {adding ? "Adding…" : "Add company"}
          </button>
          {infoMsg && (
            <span className="text-sm text-emerald-700 dark:text-emerald-400">{infoMsg}</span>
          )}
        </div>
      </fieldset>
    </section>
  );
}
