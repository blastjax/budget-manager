#!/usr/bin/env python3
"""
Extend the per-company column-visibility toggles (Settings -> Companies) to
cover every payslip amount field, not just the 6 added previously
(``show_commission``, ``show_reimbursement``, ``show_medical_reimbursement``,
``show_pag_ibig``, ``show_mp2``, ``show_trust_fund`` -- see
``add_trust_fund_and_company_flags.py``).

Adds 8 more ``company`` boolean columns, all ``NOT NULL DEFAULT true`` (every
one of these fields has always shown unconditionally until now, so nothing
changes for existing companies):

  Income-side (the main grid in PayslipFormFields):
    show_total, show_basic_salary, show_others, show_allowances,
    show_thirteenth_month

  Deduction-side (the "Deductions" aside in PayslipFormFields):
    show_withholding_tax, show_sss_contribution, show_philhealth

All additive/reversible ``ADD COLUMN`` statements, applied in one
transaction. No data seeding this time -- every company keeps showing
everything it already shows; this just gives every column its own toggle in
Settings -> Companies going forward.

Usage (from the repo root, with the venv active):

    python backend/scripts/add_remaining_company_column_flags.py [--dry-run]

Reads the Postgres URL from ``.env.local`` (``DATABASE_URL_UNPOOLED``
preferred: this is DDL, so it wants the direct endpoint, not the pooler),
same convention as ``normalize_time_types.py`` /
``add_trust_fund_and_company_flags.py``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent
_DEFAULT_ENV_FILE = _REPO_ROOT / ".env.local"

_NEW_COLUMNS = [
    "show_total",
    "show_basic_salary",
    "show_others",
    "show_allowances",
    "show_thirteenth_month",
    "show_withholding_tax",
    "show_sss_contribution",
    "show_philhealth",
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
        description="Add the remaining per-company column-visibility flags."
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
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'company'
              AND column_name = ANY(%s)
            """,
            (_NEW_COLUMNS,),
        )
        existing = [r[0] for r in cur.fetchall()]
        if existing:
            print("pre-flight FAILED; nothing changed:", file=sys.stderr)
            for c in existing:
                print(f"  company.{c} already exists", file=sys.stderr)
            conn.rollback()
            return 1
        print("pre-flight OK: none of the new columns exist yet")

        if args.dry_run:
            print("\n--dry-run: no changes made")
            conn.rollback()
            return 0

        # ---- the migration ----
        print(f"adding {len(_NEW_COLUMNS)} company column-visibility flags")
        for col in _NEW_COLUMNS:
            cur.execute(f"ALTER TABLE company ADD COLUMN {col} BOOLEAN NOT NULL DEFAULT true")

        # ---- verify before committing ----
        cur.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'company'
              AND column_name = ANY(%s)
            """,
            (_NEW_COLUMNS,),
        )
        found = {r[0] for r in cur.fetchall()}
        missing = set(_NEW_COLUMNS) - found
        if missing:
            raise RuntimeError(f"post-migration check failed, missing: {sorted(missing)}")

        conn.commit()
        print(f"\ncommitted: {len(_NEW_COLUMNS)} company flags added")
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
