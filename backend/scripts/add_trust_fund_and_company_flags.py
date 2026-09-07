#!/usr/bin/env python3
"""
Add a Trust Fund figure to payslips, and generalise the single
``company.show_commission`` toggle into a full set of per-company column
visibility flags (Settings -> Companies).

All additive/reversible ``ADD COLUMN`` statements, applied in one transaction:

  1. ``payslip.trust_fund`` (DOUBLE PRECISION, nullable) -- a new per-payslip
     amount, alongside ``commission``/``reimbursement``/``mp2``/etc.
  2. ``payslip_default.trust_fund`` (TEXT NOT NULL DEFAULT '') -- so the
     Settings -> Payslip defaults template can prefill it too, same as every
     other field there.
  3. Five new ``company`` boolean columns -- ``show_reimbursement``,
     ``show_medical_reimbursement``, ``show_pag_ibig``, ``show_mp2`` (each
     ``NOT NULL DEFAULT true``, matching today's always-shown behaviour) and
     ``show_trust_fund`` (``NOT NULL DEFAULT false``, since no company has
     ever had this field before).

Then seeds the one concrete example already known: Questronix hides
Commission (already ``false``), Reimbursement, Medical reimbursement,
Pag-ibig and MP2, and shows Trust Fund. Every other company is left alone --
its five new columns just take the DEFAULT.

Usage (from the repo root, with the venv active):

    python backend/scripts/add_trust_fund_and_company_flags.py [--dry-run]

Reads the Postgres URL from ``.env.local`` (``DATABASE_URL_UNPOOLED``
preferred: this is DDL, so it wants the direct endpoint, not the pooler),
same convention as ``normalize_time_types.py``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent
_DEFAULT_ENV_FILE = _REPO_ROOT / ".env.local"

_NEW_COMPANY_BOOL_COLUMNS = [
    ("show_reimbursement", True),
    ("show_medical_reimbursement", True),
    ("show_pag_ibig", True),
    ("show_mp2", True),
    ("show_trust_fund", False),
]


def _resolve_pg_url(env_file: Path) -> str:
    from dotenv import dotenv_values

    if not env_file.is_file():
        sys.exit(f"env file not found: {env_file}")
    values = dotenv_values(env_file)
    url = (values.get("DATABASE_URL_UNPOOLED") or values.get("DATABASE_URL") or "").strip()
    if not url.startswith(("postgres://", "postgresql://")):
        sys.exit(f"no Postgres URL in {env_file}")
    return url


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Add payslip.trust_fund and per-company column-visibility flags."
    )
    ap.add_argument("--env-file", type=Path, default=_DEFAULT_ENV_FILE)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 is required: pip install psycopg2-binary")

    url = _resolve_pg_url(args.env_file)
    conn = psycopg2.connect(url)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        # ---- pre-flight: refuse to run if any target column already exists ----
        cur.execute(
            """
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (
                (table_name = 'payslip' AND column_name = 'trust_fund')
                OR (table_name = 'payslip_default' AND column_name = 'trust_fund')
                OR (table_name = 'company' AND column_name = ANY(%s))
              )
            """,
            ([c for c, _ in _NEW_COMPANY_BOOL_COLUMNS],),
        )
        existing = cur.fetchall()
        if existing:
            print("pre-flight FAILED; nothing changed:", file=sys.stderr)
            for t, c in existing:
                print(f"  {t}.{c} already exists", file=sys.stderr)
            conn.rollback()
            return 1
        print("pre-flight OK: none of the new columns exist yet")

        if args.dry_run:
            print("\n--dry-run: no changes made")
            conn.rollback()
            return 0

        # ---- the migration ----
        print("adding payslip.trust_fund")
        cur.execute("ALTER TABLE payslip ADD COLUMN trust_fund DOUBLE PRECISION")

        print("adding payslip_default.trust_fund")
        cur.execute(
            "ALTER TABLE payslip_default ADD COLUMN trust_fund TEXT NOT NULL DEFAULT ''"
        )

        print("adding company column-visibility flags")
        for col, default in _NEW_COMPANY_BOOL_COLUMNS:
            cur.execute(
                f"ALTER TABLE company ADD COLUMN {col} BOOLEAN NOT NULL DEFAULT %s",
                (default,),
            )

        print("seeding Questronix: hide Reimbursement/Medical reimbursement/"
              "Pag-ibig/MP2, show Trust Fund")
        cur.execute(
            """
            UPDATE company SET
                show_reimbursement = false,
                show_medical_reimbursement = false,
                show_pag_ibig = false,
                show_mp2 = false,
                show_trust_fund = true
            WHERE name = 'Questronix'
            RETURNING id
            """
        )
        updated = cur.fetchall()
        if not updated:
            print("  (no company named 'Questronix' found -- skipped, not an error)")

        # ---- verify before committing ----
        cur.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (
                (table_name = 'payslip' AND column_name = 'trust_fund')
                OR (table_name = 'payslip_default' AND column_name = 'trust_fund')
                OR (table_name = 'company' AND column_name = ANY(%s))
              )
            """,
            ([c for c, _ in _NEW_COMPANY_BOOL_COLUMNS],),
        )
        found = {r[0] for r in cur.fetchall()}
        expected = {"trust_fund", *[c for c, _ in _NEW_COMPANY_BOOL_COLUMNS]}
        missing = expected - found
        if missing:
            raise RuntimeError(f"post-migration check failed, missing: {sorted(missing)}")

        conn.commit()
        print(
            f"\ncommitted: 2 trust_fund columns + {len(_NEW_COMPANY_BOOL_COLUMNS)} "
            f"company flags added ({len(updated)} company row(s) seeded)"
        )
    except Exception:
        conn.rollback()
        print("\nROLLED BACK - no changes were made", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
