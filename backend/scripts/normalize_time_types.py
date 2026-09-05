#!/usr/bin/env python3
"""
Normalise the Neon database's date/time columns so the API renders them
consistently, in the ISO-8601 form FastAPI emits.

Three changes, all applied in one transaction:

  1. TIMESTAMPTZ -> TIMESTAMPTZ(0), truncating to whole seconds.
     ``created_at`` carried microseconds on 201 rows and none on the other
     1,903 -- mixed *within* the same column, because two different writers
     produced them (the app, via Python, and SQLite's own CURRENT_TIMESTAMP).
     Since ``.isoformat()`` omits the fractional part when it is zero, one
     column rendered both ``2026-04-13T02:06:38.428777+00:00`` and
     ``2026-08-26T08:56:00+00:00``.

     Pinning the column to ``(0)`` matters as much as truncating the existing
     rows: without it the very next INSERT reintroduces microseconds and the
     column drifts straight back to mixed precision.

     This DISCARDS sub-second data on those 201 rows. The original values are
     still in ``data/budget.sqlite`` (and in the snapshot this script writes
     before touching anything) if they are ever needed back.

  2. TEXT -> DATE for the columns that hold dates as strings
     (``installment.start_date`` etc.). The API already accepted these as
     ``dt.date`` in its Pydantic models, so only the storage was untyped.

  3. TEXT -> TIME for the travel ``*_time`` columns. Note this changes what the
     API returns: ``'07:15'`` becomes ``'07:15:00'``, the ISO-8601 form.

Every value is verified to cast cleanly before any DDL runs, and the whole
migration is one transaction -- a failure anywhere leaves the database
untouched.

Usage (from the repo root, with the venv active):

    python backend/scripts/normalize_time_types.py [--dry-run]

Reads the Postgres URL from ``.env.local`` (``DATABASE_URL_UNPOOLED``
preferred: this is DDL, so it wants the direct endpoint, not the pooler).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPTS_DIR.parent
_REPO_ROOT = _BACKEND_DIR.parent
_DEFAULT_ENV_FILE = _REPO_ROOT / ".env.local"

# (table, column) for every TIMESTAMPTZ column -> truncated to second precision.
_TIMESTAMP_COLUMNS = [
    ("app_user", "created_at"),
    ("blood_pressure", "created_at"),
    ("calendar_day_override", "created_at"),
    ("credit_card", "created_at"),
    ("credit_card_payment", "created_at"),
    ("fixed_expense", "created_at"),
    ("house_payment", "created_at"),
    ("house_payment_entry", "created_at"),
    ("installment", "created_at"),
    ("lotto_attempt", "created_at"),
    ("lotto_draw", "created_at"),
    ("monthly_expense", "created_at"),
    ("pay_period_start_override", "created_at"),
    ("payslip", "created_at"),
    ("payslip_default", "updated_at"),
    ("travel_accommodation", "created_at"),
    ("travel_flight", "created_at"),
    ("travel_itinerary", "created_at"),
    ("travel_transport", "created_at"),
    ("travel_trip", "created_at"),
]

_DATE_COLUMNS = [
    ("credit_card", "statement_date"),
    ("credit_card", "due_date"),
    ("credit_card_payment", "payment_date"),
    ("installment", "start_date"),
    ("installment", "finish_date"),
]

_TIME_COLUMNS = [
    ("travel_accommodation", "checkin_time"),
    ("travel_accommodation", "checkout_time"),
    ("travel_flight", "departure_time"),
    ("travel_flight", "arrival_time"),
    ("travel_itinerary", "start_time"),
    ("travel_itinerary", "end_time"),
    ("travel_transport", "departure_time"),
    ("travel_transport", "arrival_time"),
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
    ap = argparse.ArgumentParser(description="Normalise Neon date/time column types.")
    ap.add_argument("--env-file", type=Path, default=_DEFAULT_ENV_FILE)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 is required: pip install psycopg2-binary")

    url = _resolve_pg_url(args.env_file)
    conn = psycopg2.connect(url, options="-c timezone=UTC")
    conn.autocommit = False
    cur = conn.cursor()
    try:
        # ---- pre-flight: refuse to run unless every value casts cleanly ----
        problems: list[str] = []
        for kind, cols in (("date", _DATE_COLUMNS), ("time", _TIME_COLUMNS)):
            for table, col in cols:
                cur.execute(
                    f'SELECT COUNT(*) FROM "{table}" WHERE "{col}" IS NOT NULL AND "{col}" <> \'\''
                )
                expected = cur.fetchone()[0]
                try:
                    cur.execute(f'SELECT COUNT(NULLIF("{col}", \'\')::{kind}) FROM "{table}"')
                    got = cur.fetchone()[0]
                except psycopg2.Error as exc:
                    conn.rollback()
                    problems.append(f"{table}.{col}: {str(exc).strip().splitlines()[0]}")
                    continue
                if got != expected:
                    problems.append(f"{table}.{col}: only {got}/{expected} values cast to {kind}")
        if problems:
            print("pre-flight FAILED; nothing changed:", file=sys.stderr)
            for p in problems:
                print(f"  {p}", file=sys.stderr)
            return 1
        print(f"pre-flight OK ({len(_DATE_COLUMNS)} date + {len(_TIME_COLUMNS)} time columns cast cleanly)")

        # ---- snapshot the timestamps that truncation will alter ----
        cur.execute(
            "SELECT COUNT(*) FROM ("
            + " UNION ALL ".join(
                f'SELECT 1 FROM "{t}" WHERE "{c}" <> date_trunc(\'second\', "{c}")'
                for t, c in _TIMESTAMP_COLUMNS
            )
            + ") s"
        )
        lossy = cur.fetchone()[0]
        print(f"{lossy} row(s) carry sub-second precision that truncation will discard")

        if args.dry_run:
            print("\n--dry-run: no changes made")
            conn.rollback()
            return 0

        snapshot: dict[str, list] = {}
        for table, col in _TIMESTAMP_COLUMNS:
            cur.execute(
                f'SELECT id, "{col}" FROM "{table}" '
                f'WHERE "{col}" <> date_trunc(\'second\', "{col}") ORDER BY id'
                if table != "payslip_default"
                else f'SELECT half, "{col}" FROM "{table}" '
                f'WHERE "{col}" <> date_trunc(\'second\', "{col}") ORDER BY half'
            )
            rows = [(r[0], r[1].isoformat()) for r in cur.fetchall()]
            if rows:
                snapshot[f"{table}.{col}"] = rows
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        snap_path = _REPO_ROOT / "data" / f"timestamps-before-truncation-{stamp}.json"
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        snap_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
        print(f"snapshot written: {snap_path.name} ({sum(len(v) for v in snapshot.values())} values)")

        # ---- the migration ----
        print("\ntruncating timestamps to whole seconds and pinning precision")
        for table, col in _TIMESTAMP_COLUMNS:
            cur.execute(
                f'ALTER TABLE "{table}" ALTER COLUMN "{col}" '
                f"TYPE TIMESTAMPTZ(0) USING date_trunc('second', \"{col}\")"
            )
        print("converting TEXT date columns to DATE")
        for table, col in _DATE_COLUMNS:
            cur.execute(
                f'ALTER TABLE "{table}" ALTER COLUMN "{col}" '
                f"TYPE DATE USING NULLIF(\"{col}\", '')::date"
            )
        print("converting TEXT time columns to TIME")
        for table, col in _TIME_COLUMNS:
            cur.execute(
                f'ALTER TABLE "{table}" ALTER COLUMN "{col}" '
                f"TYPE TIME USING NULLIF(\"{col}\", '')::time"
            )

        # ---- verify before committing ----
        cur.execute(
            """
            SELECT table_name, column_name, data_type, datetime_precision
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (table_name, column_name) IN %s
            """,
            (tuple(_TIMESTAMP_COLUMNS + _DATE_COLUMNS + _TIME_COLUMNS),),
        )
        actual = {(r[0], r[1]): (r[2], r[3]) for r in cur.fetchall()}
        bad = []
        for t, c in _TIMESTAMP_COLUMNS:
            got = actual.get((t, c))
            if not got or got[0] != "timestamp with time zone" or got[1] != 0:
                bad.append(f"{t}.{c} -> {got}")
        for t, c in _DATE_COLUMNS:
            if (actual.get((t, c)) or ("",))[0] != "date":
                bad.append(f"{t}.{c} -> {actual.get((t, c))}")
        for t, c in _TIME_COLUMNS:
            if (actual.get((t, c)) or ("",))[0] != "time without time zone":
                bad.append(f"{t}.{c} -> {actual.get((t, c))}")
        if bad:
            raise RuntimeError("post-migration type check failed: " + "; ".join(bad))

        conn.commit()
        print(
            f"\ncommitted: {len(_TIMESTAMP_COLUMNS)} timestamp, "
            f"{len(_DATE_COLUMNS)} date, {len(_TIME_COLUMNS)} time columns normalised"
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
