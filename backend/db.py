"""
Payslip and installment storage: local SQLite file under ``data/`` (default
``<repo-root>/data/budget.sqlite``, overridable via ``DATABASE_URL``).
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent
_DEFAULT_SQLITE_PATH = _REPO_ROOT / "data" / "budget.sqlite"


def _load_env_files() -> None:
    """Load repo-root `.env` then `backend/.env` (or `/app/.env` in the API image)."""
    for path in (_BACKEND_DIR.parent / ".env", _BACKEND_DIR / ".env"):
        if path.is_file():
            load_dotenv(path, override=True)


_load_env_files()


def _parse_sqlite_path(raw: str) -> Path:
    """Accept a ``sqlite:///relative/path``, ``sqlite:////absolute/path`` URL,
    or a bare filesystem path. Relative paths resolve against the repo root
    (the same anchor the migration script uses), so a local ``uvicorn`` run
    and the one-off migration agree on where the file lives."""
    s = raw.strip()
    low = s.lower()
    if low.startswith("sqlite:///"):
        s = s[len("sqlite:///") :]
    elif low.startswith("sqlite:"):
        s = s[len("sqlite:") :]
    path = Path(s)
    if not path.is_absolute():
        path = _REPO_ROOT / path
    return path


def sqlite_path() -> Path:
    """Resolve the SQLite file location: ``DATABASE_URL`` if set, else the
    default ``data/budget.sqlite`` under the repo root."""
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if raw:
        return _parse_sqlite_path(raw)
    return _DEFAULT_SQLITE_PATH


def database_url() -> str:
    """The database this app always reads from and writes to."""
    return f"sqlite:///{sqlite_path().as_posix()}"


def cloud_database_url() -> str:
    """Back-compat alias for ``database_url()`` — kept so callers that used to
    distinguish "the cloud DB" from a local override don't need to change."""
    return database_url()


def storage_kind() -> str:
    return "sqlite"


def use_database() -> bool:
    """The SQLite file is self-provisioning, so storage is always available."""
    return True


def close_connection_pool() -> None:
    """No-op: SQLite connections here are opened and closed per call, not pooled."""
    return None


@contextmanager
def db_cursor(conn: sqlite3.Connection):
    cur = conn.cursor()
    try:
        yield cur
    finally:
        cur.close()


@contextmanager
def get_connection():
    """Open, use, and close one SQLite connection for the duration of the block.

    Commits on success; rolls back on any exception so a failed multi-statement
    write (e.g. insert + recompute) never leaves a partial change committed.
    """
    path = sqlite_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def check_connection() -> bool:
    try:
        with get_connection() as conn:
            with db_cursor(conn) as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


def _row_to_dict(cur: Any, row: Any) -> dict[str, Any]:
    return dict(zip([d[0] for d in cur.description], row))


def _with_bool(row: dict[str, Any], key: str) -> dict[str, Any]:
    """SQLite has no native boolean storage class — the driver hands back plain
    ``0``/``1`` integers for BOOLEAN-affinity columns and boolean expressions,
    where Postgres/psycopg2 gave a real ``bool``. Coerce so JSON responses keep
    serializing as ``true``/``false`` instead of ``1``/``0``."""
    if key in row and row[key] is not None:
        row[key] = bool(row[key])
    return row


# One CREATE TABLE (plus its indexes) per statement, in FK-safe dependency
# order: ``credit_card`` and ``house_payment`` before the tables that
# reference them, ``installment`` before ``installment_line``. Uses
# ``IF NOT EXISTS`` throughout, so re-running against a database that already
# has these tables (e.g. one produced by
# ``backend/scripts/migrate_postgres_to_sqlite.py``) is a no-op.
_SCHEMA_STATEMENTS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS credit_card (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        credit_limit REAL NOT NULL,
        last_statement_balance REAL NOT NULL DEFAULT 0,
        current_balance REAL NOT NULL DEFAULT 0,
        minimum_due REAL NOT NULL DEFAULT 0,
        interest_rate REAL NOT NULL DEFAULT 3.5,
        statement_date TEXT,
        due_date TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (
            credit_limit >= 0 AND last_statement_balance >= 0
            AND minimum_due >= 0 AND interest_rate >= 0
        )
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS payslip (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total REAL,
        commission REAL,
        reimbursement REAL,
        medical_reimbursement REAL,
        others REAL,
        mp2 REAL,
        allowances REAL,
        thirteenth_month REAL,
        basic_salary REAL,
        period_year INTEGER,
        period_month INTEGER,
        period_half INTEGER,
        notes TEXT,
        withholding_tax REAL,
        sss_contribution REAL,
        philhealth REAL,
        pag_ibig REAL,
        pdf_data BLOB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_payslip_created ON payslip (created_at DESC)",
    """
    CREATE INDEX IF NOT EXISTS idx_payslip_period_sort ON payslip (
        period_year DESC, period_month DESC, period_half DESC, created_at DESC
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS installment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        installment_current INTEGER NOT NULL,
        installment_total INTEGER NOT NULL,
        principal REAL NOT NULL,
        interest REAL,
        payment_total REAL NOT NULL,
        start_date TEXT NOT NULL,
        finish_date TEXT NOT NULL,
        remaining REAL NOT NULL,
        original_total REAL NOT NULL,
        credit_card_id INTEGER REFERENCES credit_card(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (
            installment_total >= 1
            AND installment_current >= 1
            AND installment_current <= installment_total + 1
        ),
        CHECK (payment_total >= 0 AND remaining >= 0)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_installment_created ON installment (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_installment_finish_name ON installment (finish_date, name)",
    "CREATE INDEX IF NOT EXISTS idx_installment_credit_card_id ON installment (credit_card_id)",
    """
    CREATE TABLE IF NOT EXISTS installment_line (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        installment_id INTEGER NOT NULL REFERENCES installment(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        principal REAL NOT NULL DEFAULT 0,
        interest REAL,
        payment_total REAL NOT NULL,
        UNIQUE (installment_id, seq)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_installment_line_parent ON installment_line (installment_id)",
    """
    CREATE TABLE IF NOT EXISTS house_payment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_house_payment_created ON house_payment (created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_house_payment_name ON house_payment (name)",
    """
    CREATE TABLE IF NOT EXISTS house_payment_entry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        house_payment_id INTEGER NOT NULL REFERENCES house_payment(id) ON DELETE CASCADE,
        paid_on DATE NOT NULL,
        amount REAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (amount >= 0)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_house_payment_entry_parent
        ON house_payment_entry (house_payment_id, paid_on DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS blood_pressure (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        systolic INTEGER,
        diastolic INTEGER,
        pulse INTEGER,
        spo2 INTEGER,
        temperature NUMERIC(5, 2),
        weight NUMERIC(6, 2),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (
            (systolic IS NULL AND diastolic IS NULL AND pulse IS NULL)
            OR (systolic > 0 AND diastolic > 0 AND pulse > 0)
        ),
        CHECK (spo2 IS NULL OR (spo2 > 0 AND spo2 <= 100)),
        CHECK (temperature IS NULL OR (temperature > 25 AND temperature <= 45)),
        CHECK (weight IS NULL OR weight > 0),
        CHECK (
            systolic IS NOT NULL OR diastolic IS NOT NULL OR pulse IS NOT NULL
            OR spo2 IS NOT NULL OR temperature IS NOT NULL OR weight IS NOT NULL
            OR notes IS NOT NULL
        )
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_blood_pressure_created ON blood_pressure (created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS fixed_expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_half INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        period_month INTEGER NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (period_half IN (1, 2)),
        CHECK (amount > 0),
        CHECK (period_month BETWEEN 1 AND 12)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_fixed_expense_period
        ON fixed_expense (period_year, period_month, period_half, created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS monthly_expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        amount REAL NOT NULL,
        period_half INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        period_month INTEGER NOT NULL,
        is_recurring BOOLEAN NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (period_half IN (1, 2)),
        CHECK (amount > 0),
        CHECK (period_month BETWEEN 1 AND 12)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_monthly_expense_period
        ON monthly_expense (period_year, period_month, period_half, created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS calendar_day_override (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day DATE NOT NULL UNIQUE,
        amount REAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (amount >= 0)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pay_period_start_override (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_year INTEGER NOT NULL,
        period_month INTEGER NOT NULL,
        period_half INTEGER NOT NULL,
        start_date DATE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (period_half IN (1, 2)),
        CHECK (period_month BETWEEN 1 AND 12),
        UNIQUE (period_year, period_month, period_half)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS payslip_default (
        half INTEGER PRIMARY KEY,
        period_year TEXT NOT NULL DEFAULT '',
        period_month TEXT NOT NULL DEFAULT '',
        total TEXT NOT NULL DEFAULT '',
        basic_salary TEXT NOT NULL DEFAULT '',
        commission TEXT NOT NULL DEFAULT '',
        reimbursement TEXT NOT NULL DEFAULT '',
        medical_reimbursement TEXT NOT NULL DEFAULT '',
        others TEXT NOT NULL DEFAULT '',
        mp2 TEXT NOT NULL DEFAULT '',
        allowances TEXT NOT NULL DEFAULT '',
        thirteenth_month TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        withholding_tax TEXT NOT NULL DEFAULT '',
        sss_contribution TEXT NOT NULL DEFAULT '',
        philhealth TEXT NOT NULL DEFAULT '',
        pag_ibig TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (half IN (1, 2))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS payslip_default_settings (
        id INTEGER PRIMARY KEY,
        settings_half TEXT NOT NULL DEFAULT 'first',
        CHECK (id = 1),
        CHECK (settings_half IN ('first', 'second'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS credit_card_payment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card_id INTEGER NOT NULL REFERENCES credit_card(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (amount > 0)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_credit_card_payment_parent
        ON credit_card_payment (credit_card_id, payment_date DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS lotto_draw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draw_date DATE NOT NULL UNIQUE,
        n1 INTEGER,
        n2 INTEGER,
        n3 INTEGER,
        n4 INTEGER,
        n5 INTEGER,
        n6 INTEGER,
        jackpot_prize REAL,
        winners INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (
            (n1 IS NULL AND n2 IS NULL AND n3 IS NULL AND n4 IS NULL AND n5 IS NULL AND n6 IS NULL)
            OR (n1 >= 1 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6 AND n6 <= 58)
        ),
        CHECK (jackpot_prize IS NULL OR jackpot_prize >= 0),
        CHECK (winners >= 0)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_lotto_draw_date ON lotto_draw (draw_date DESC)",
    """
    CREATE TABLE IF NOT EXISTS lotto_attempt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draw_id INTEGER NOT NULL REFERENCES lotto_draw(id) ON DELETE CASCADE,
        ticket INTEGER,
        n1 INTEGER NOT NULL,
        n2 INTEGER NOT NULL,
        n3 INTEGER NOT NULL,
        n4 INTEGER NOT NULL,
        n5 INTEGER NOT NULL,
        n6 INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (n1 >= 1 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6 AND n6 <= 58)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_lotto_attempt_parent ON lotto_attempt (draw_id, created_at)",
    """
    CREATE TABLE IF NOT EXISTS travel_trip (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        entry_year INTEGER NOT NULL,
        entry_month INTEGER NOT NULL,
        -- Inclusive end month, same year, for a trip spanning several
        -- consecutive months. Equal to entry_month for a single-month trip
        -- (the default the "Add trip" form starts you on).
        entry_month_end INTEGER NOT NULL,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(trim(title)) > 0),
        CHECK (entry_month BETWEEN 1 AND 12),
        CHECK (entry_month_end BETWEEN 1 AND 12),
        CHECK (entry_month_end >= entry_month)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_travel_trip_period
        ON travel_trip (entry_year DESC, entry_month DESC, id DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS travel_flight (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL REFERENCES travel_trip(id) ON DELETE CASCADE,
        flight_number TEXT NOT NULL,
        flight_date DATE,
        departure_time TEXT,
        arrival_time TEXT,
        from_location TEXT,
        from_map_url TEXT,
        to_location TEXT,
        to_map_url TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(trim(flight_number)) > 0)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_travel_flight_parent
        ON travel_flight (trip_id, flight_date, created_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS travel_itinerary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL REFERENCES travel_trip(id) ON DELETE CASCADE,
        item_date DATE NOT NULL,
        -- Optional end date for an item that spans past its start date (an
        -- overnight train, a multi-day trek); NULL means a same-day item.
        item_end_date DATE,
        start_time TEXT,
        end_time TEXT,
        activity TEXT NOT NULL,
        location_name TEXT,
        location_map_url TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(trim(activity)) > 0),
        CHECK (item_end_date IS NULL OR item_end_date >= item_date)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_travel_itinerary_parent
        ON travel_itinerary (trip_id, item_date, start_time, created_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS travel_accommodation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL REFERENCES travel_trip(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        checkin_date DATE NOT NULL,
        checkout_date DATE NOT NULL,
        checkin_time TEXT,
        checkout_time TEXT,
        booking_confirmation TEXT,
        instructions TEXT,
        location_name TEXT,
        location_map_url TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(trim(name)) > 0),
        CHECK (checkout_date >= checkin_date)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_travel_accommodation_parent
        ON travel_accommodation (trip_id, checkin_date, created_at)
    """,
    """
    CREATE TABLE IF NOT EXISTS app_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(trim(username)) > 0)
    )
    """,
]


def _migrate_lotto_draw_allow_pending() -> None:
    """Older DBs have ``n1``..``n6`` NOT NULL on ``lotto_draw``. Rebuild the
    table so a draw's date can be logged before its winning numbers are
    known — attempts can be recorded ahead of the actual draw, then the
    result filled in later via the same edit form.

    Runs on its own autocommit connection (outside ``get_connection()``, which
    turns foreign keys on) since SQLite requires FKs off for a table rebuild
    like this, and that pragma is a no-op inside a transaction."""
    path = sqlite_path()
    if not path.exists():
        return  # fresh DB — the CREATE TABLE statement below defines it correctly
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    try:
        cols = conn.execute("PRAGMA table_info(lotto_draw)").fetchall()
        if not cols:
            return  # table doesn't exist yet
        notnull_by_name = {c[1]: c[3] for c in cols}
        if not notnull_by_name.get("n1"):
            return  # already migrated (nullable), or an unexpected shape — leave alone
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN")
        try:
            conn.execute(
                """
                CREATE TABLE lotto_draw_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    draw_date DATE NOT NULL UNIQUE,
                    n1 INTEGER, n2 INTEGER, n3 INTEGER, n4 INTEGER, n5 INTEGER, n6 INTEGER,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CHECK (
                        (n1 IS NULL AND n2 IS NULL AND n3 IS NULL AND n4 IS NULL AND n5 IS NULL AND n6 IS NULL)
                        OR (n1 >= 1 AND n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6 AND n6 <= 58)
                    )
                )
                """
            )
            conn.execute(
                """
                INSERT INTO lotto_draw_new (id, draw_date, n1, n2, n3, n4, n5, n6, created_at)
                SELECT id, draw_date, n1, n2, n3, n4, n5, n6, created_at FROM lotto_draw
                """
            )
            conn.execute("DROP TABLE lotto_draw")
            conn.execute("ALTER TABLE lotto_draw_new RENAME TO lotto_draw")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_lotto_draw_date ON lotto_draw (draw_date DESC)"
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON")
    finally:
        conn.close()


def _migrate_lotto_attempt_add_ticket() -> None:
    """Older DBs don't have the ``ticket`` column on ``lotto_attempt``. Attempts
    uploaded together as one physical ticket (up to a handful of board plays)
    share a ticket number so the UI can cluster them; existing attempts get
    ``ticket = NULL`` (ungrouped) and can be assigned one later via edit."""
    path = sqlite_path()
    if not path.exists():
        return  # fresh DB — the CREATE TABLE statement below defines it correctly
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    try:
        cols = conn.execute("PRAGMA table_info(lotto_attempt)").fetchall()
        if not cols:
            return  # table doesn't exist yet
        if any(c[1] == "ticket" for c in cols):
            return  # already migrated
        conn.execute("ALTER TABLE lotto_attempt ADD COLUMN ticket INTEGER")
    finally:
        conn.close()


def _migrate_lotto_attempt_add_hidden() -> None:
    """Older DBs don't have the ``hidden`` column on ``lotto_attempt``. Hiding
    an attempt tucks it out of the normal view without deleting it; existing
    attempts get ``hidden = 0`` (visible)."""
    path = sqlite_path()
    if not path.exists():
        return  # fresh DB — the CREATE TABLE statement below defines it correctly
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    try:
        cols = conn.execute("PRAGMA table_info(lotto_attempt)").fetchall()
        if not cols:
            return  # table doesn't exist yet
        if any(c[1] == "hidden" for c in cols):
            return  # already migrated
        conn.execute("ALTER TABLE lotto_attempt ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
    finally:
        conn.close()


def _migrate_lotto_draw_add_jackpot_winners() -> None:
    """Older DBs don't have ``jackpot_prize``/``winners`` on ``lotto_draw``.
    Existing draws get ``jackpot_prize = NULL`` and ``winners = 0`` until
    backfilled (e.g. via the historic-results import)."""
    path = sqlite_path()
    if not path.exists():
        return  # fresh DB — the CREATE TABLE statement below defines it correctly
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    try:
        cols = conn.execute("PRAGMA table_info(lotto_draw)").fetchall()
        if not cols:
            return  # table doesn't exist yet
        names = {c[1] for c in cols}
        if "jackpot_prize" not in names:
            conn.execute("ALTER TABLE lotto_draw ADD COLUMN jackpot_prize REAL")
        if "winners" not in names:
            conn.execute(
                "ALTER TABLE lotto_draw ADD COLUMN winners INTEGER NOT NULL DEFAULT 0"
            )
    finally:
        conn.close()


def _migrate_travel_trip_add_month_end() -> None:
    """Older DBs don't have ``entry_month_end`` on ``travel_trip``. Existing
    (single-month) trips get ``entry_month_end = entry_month`` — the same
    default a freshly-created trip starts with."""
    path = sqlite_path()
    if not path.exists():
        return  # fresh DB — the CREATE TABLE statement below defines it correctly
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    try:
        cols = conn.execute("PRAGMA table_info(travel_trip)").fetchall()
        if not cols:
            return  # table doesn't exist yet
        if any(c[1] == "entry_month_end" for c in cols):
            return  # already migrated
        conn.execute("ALTER TABLE travel_trip ADD COLUMN entry_month_end INTEGER")
        conn.execute("UPDATE travel_trip SET entry_month_end = entry_month WHERE entry_month_end IS NULL")
    finally:
        conn.close()


def _migrate_travel_itinerary_add_end_date() -> None:
    """Older DBs don't have ``item_end_date`` on ``travel_itinerary``. Existing
    items stay same-day (``item_end_date = NULL``) until edited to add a span —
    e.g. an overnight train logged as a single-day item before this existed."""
    path = sqlite_path()
    if not path.exists():
        return  # fresh DB — the CREATE TABLE statement below defines it correctly
    conn = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    try:
        cols = conn.execute("PRAGMA table_info(travel_itinerary)").fetchall()
        if not cols:
            return  # table doesn't exist yet
        if any(c[1] == "item_end_date" for c in cols):
            return  # already migrated
        conn.execute("ALTER TABLE travel_itinerary ADD COLUMN item_end_date DATE")
    finally:
        conn.close()


def init_schema() -> None:
    """Create every table/index that doesn't already exist. Idempotent and cheap
    enough to call on every startup — ``CREATE ... IF NOT EXISTS`` short-circuits
    once the schema is in place."""
    _migrate_lotto_draw_allow_pending()
    _migrate_lotto_attempt_add_ticket()
    _migrate_lotto_attempt_add_hidden()
    _migrate_lotto_draw_add_jackpot_winners()
    _migrate_travel_trip_add_month_end()
    _migrate_travel_itinerary_add_end_date()
    with get_connection() as conn:
        for stmt in _SCHEMA_STATEMENTS:
            conn.execute(stmt)
        conn.commit()


_PAYSLIP_RETURN_COLS = """
    id, total, commission, reimbursement,
    medical_reimbursement, others, mp2, allowances,
    thirteenth_month, basic_salary,
    period_year, period_month, period_half, notes,
    withholding_tax, sss_contribution, philhealth, pag_ibig,
    (pdf_data IS NOT NULL) AS has_pdf,
    created_at
"""


def insert_payslip(
    total: float | None,
    commission: float | None,
    reimbursement: float | None,
    medical_reimbursement: float | None,
    others: float | None,
    mp2: float | None,
    allowances: float | None,
    thirteenth_month: float | None,
    basic_salary: float | None,
    period_year: int | None,
    period_month: int | None,
    period_half: int | None,
    notes: str | None,
    withholding_tax: float | None = None,
    sss_contribution: float | None = None,
    philhealth: float | None = None,
    pag_ibig: float | None = None,
) -> dict[str, Any]:
    """Insert and return the full row (single round trip thanks to ``RETURNING``)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO payslip (
                    total, commission, reimbursement,
                    medical_reimbursement, others, mp2, allowances,
                    thirteenth_month, basic_salary,
                    period_year, period_month, period_half, notes,
                    withholding_tax, sss_contribution, philhealth, pag_ibig
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING {_PAYSLIP_RETURN_COLS}
                """,
                (
                    total,
                    commission,
                    reimbursement,
                    medical_reimbursement,
                    others,
                    mp2,
                    allowances,
                    thirteenth_month,
                    basic_salary,
                    period_year,
                    period_month,
                    period_half,
                    notes,
                    withholding_tax,
                    sss_contribution,
                    philhealth,
                    pag_ibig,
                ),
            )
            return _with_bool(_row_to_dict(cur, cur.fetchone()), "has_pdf")


_PAYSLIP_INSERT_COLS: tuple[str, ...] = (
    "total",
    "commission",
    "reimbursement",
    "medical_reimbursement",
    "others",
    "mp2",
    "allowances",
    "thirteenth_month",
    "basic_salary",
    "period_year",
    "period_month",
    "period_half",
    "notes",
    "withholding_tax",
    "sss_contribution",
    "philhealth",
    "pag_ibig",
)


def insert_payslips_bulk(records: list[dict[str, Any]]) -> list[int]:
    """Insert many payslips in a single transaction; returns the new ids in order.

    Used by the JSON import so a multi-row file is all-or-nothing: if any row
    fails, ``get_connection`` rolls the whole batch back instead of leaving a
    partial import committed. One ``INSERT ... VALUES (...), (...)`` round trip
    replaces the previous per-row connect + insert loop.
    """
    if not records:
        return []
    placeholders = "(" + ", ".join(["?"] * len(_PAYSLIP_INSERT_COLS)) + ")"
    values_sql = ", ".join([placeholders] * len(records))
    params: list[Any] = []
    for rec in records:
        for col in _PAYSLIP_INSERT_COLS:
            params.append(rec.get(col))
    sql = (
        f"INSERT INTO payslip ({', '.join(_PAYSLIP_INSERT_COLS)}) "
        f"VALUES {values_sql} RETURNING id"
    )
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(sql, params)
            return [int(r[0]) for r in cur.fetchall()]


def list_payslips(limit: int = 200) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_PAYSLIP_RETURN_COLS}
                FROM payslip
                ORDER BY period_year DESC NULLS LAST,
                         period_month DESC NULLS LAST,
                         period_half DESC NULLS LAST,
                         created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
            cols = [d[0] for d in cur.description]
            return [_with_bool(dict(zip(cols, r)), "has_pdf") for r in cur.fetchall()]


def get_payslip(payslip_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"SELECT {_PAYSLIP_RETURN_COLS} FROM payslip WHERE id = ?",
                (payslip_id,),
            )
            row = cur.fetchone()
            return _with_bool(_row_to_dict(cur, row), "has_pdf") if row else None


def update_payslip(
    payslip_id: int,
    total: float | None,
    commission: float | None,
    reimbursement: float | None,
    medical_reimbursement: float | None,
    others: float | None,
    mp2: float | None,
    allowances: float | None,
    thirteenth_month: float | None,
    basic_salary: float | None,
    period_year: int | None,
    period_month: int | None,
    period_half: int | None,
    notes: str | None,
    withholding_tax: float | None = None,
    sss_contribution: float | None = None,
    philhealth: float | None = None,
    pag_ibig: float | None = None,
) -> dict[str, Any] | None:
    """Update and return the full row, or ``None`` if no row matched."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                UPDATE payslip SET
                    total = ?,
                    commission = ?,
                    reimbursement = ?,
                    medical_reimbursement = ?,
                    others = ?,
                    mp2 = ?,
                    allowances = ?,
                    thirteenth_month = ?,
                    basic_salary = ?,
                    period_year = ?,
                    period_month = ?,
                    period_half = ?,
                    notes = ?,
                    withholding_tax = ?,
                    sss_contribution = ?,
                    philhealth = ?,
                    pag_ibig = ?
                WHERE id = ?
                RETURNING {_PAYSLIP_RETURN_COLS}
                """,
                (
                    total,
                    commission,
                    reimbursement,
                    medical_reimbursement,
                    others,
                    mp2,
                    allowances,
                    thirteenth_month,
                    basic_salary,
                    period_year,
                    period_month,
                    period_half,
                    notes,
                    withholding_tax,
                    sss_contribution,
                    philhealth,
                    pag_ibig,
                    payslip_id,
                ),
            )
            row = cur.fetchone()
            return _with_bool(_row_to_dict(cur, row), "has_pdf") if row else None


def delete_payslip(payslip_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM payslip WHERE id = ?", (payslip_id,))
            return cur.rowcount > 0


def set_payslip_pdf(payslip_id: int, data: bytes) -> bool:
    """Attach (or replace) the single PDF for a payslip. False if no such row."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "UPDATE payslip SET pdf_data = ? WHERE id = ?",
                (data, payslip_id),
            )
            return cur.rowcount > 0


def get_payslip_pdf(payslip_id: int) -> bytes | None:
    """Return the payslip's PDF bytes, or None if unset."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "SELECT pdf_data FROM payslip WHERE id = ?",
                (payslip_id,),
            )
            row = cur.fetchone()
            if not row or row[0] is None:
                return None
            return bytes(row[0])


def delete_payslip_pdf(payslip_id: int) -> bool:
    """Detach the PDF from a payslip. False if no such row."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "UPDATE payslip SET pdf_data = NULL WHERE id = ?",
                (payslip_id,),
            )
            return cur.rowcount > 0


def list_installments(
    limit: int = 500, credit_card_id: int | None = None
) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            if credit_card_id is None:
                cur.execute(
                    """
                    SELECT i.id, i.name, i.installment_current, i.installment_total,
                           i.principal, i.interest, i.payment_total, i.start_date, i.finish_date,
                           i.remaining, i.original_total, i.credit_card_id, i.created_at,
                           COALESCE(il.payment_total, i.payment_total) AS due_payment
                    FROM installment i
                    LEFT JOIN installment_line il
                        ON il.installment_id = i.id AND il.seq = i.installment_current
                    ORDER BY i.finish_date ASC, i.name ASC
                    LIMIT ?
                    """,
                    (limit,),
                )
            else:
                cur.execute(
                    """
                    SELECT i.id, i.name, i.installment_current, i.installment_total,
                           i.principal, i.interest, i.payment_total, i.start_date, i.finish_date,
                           i.remaining, i.original_total, i.credit_card_id, i.created_at,
                           COALESCE(il.payment_total, i.payment_total) AS due_payment
                    FROM installment i
                    LEFT JOIN installment_line il
                        ON il.installment_id = i.id AND il.seq = i.installment_current
                    WHERE i.credit_card_id = ?
                    ORDER BY i.finish_date ASC, i.name ASC
                    LIMIT ?
                    """,
                    (credit_card_id, limit),
                )
            cols = [d[0] for d in cur.description]
            out: list[dict[str, Any]] = []
            for r in cur.fetchall():
                out.append(dict(zip(cols, r)))
            return out


def list_installments_with_lines(limit: int = 500) -> list[dict[str, Any]]:
    """
    All plans with their schedule lines, fetched in two queries (header list +
    all lines) and grouped in Python. Lets the UI build a payments-by-month view
    in a single request instead of one ``GET /{id}`` detail call per plan.
    """
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                SELECT i.id, i.name, i.installment_current, i.installment_total,
                       i.principal, i.interest, i.payment_total, i.start_date, i.finish_date,
                       i.remaining, i.original_total, i.credit_card_id, i.created_at,
                       COALESCE(il.payment_total, i.payment_total) AS due_payment
                FROM installment i
                LEFT JOIN installment_line il
                    ON il.installment_id = i.id AND il.seq = i.installment_current
                ORDER BY i.finish_date ASC, i.name ASC
                LIMIT ?
                """,
                (limit,),
            )
            cols = [d[0] for d in cur.description]
            headers = [dict(zip(cols, r)) for r in cur.fetchall()]
            if not headers:
                return []
            ids = [h["id"] for h in headers]
            placeholders = ",".join("?" * len(ids))
            cur.execute(
                f"""
                SELECT installment_id, id, seq, principal, interest, payment_total
                FROM installment_line
                WHERE installment_id IN ({placeholders})
                ORDER BY installment_id ASC, seq ASC
                """,
                ids,
            )
            lcols = [d[0] for d in cur.description]
            lines_by_iid: dict[int, list[dict[str, Any]]] = {}
            for r in cur.fetchall():
                d = dict(zip(lcols, r))
                iid = d.pop("installment_id")
                lines_by_iid.setdefault(iid, []).append(d)
            return [
                {"installment": h, "lines": lines_by_iid.get(h["id"], [])}
                for h in headers
            ]


def _installment_row_dict(cur: Any, installment_id: int) -> dict[str, Any] | None:
    """Read one installment header row including the joined ``due_payment`` field."""
    cur.execute(
        """
        SELECT i.id, i.name, i.installment_current, i.installment_total,
               i.principal, i.interest, i.payment_total, i.start_date, i.finish_date,
               i.remaining, i.original_total, i.credit_card_id, i.created_at,
               COALESCE(il.payment_total, i.payment_total) AS due_payment
        FROM installment i
        LEFT JOIN installment_line il
            ON il.installment_id = i.id AND il.seq = i.installment_current
        WHERE i.id = ?
        """,
        (installment_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return _row_to_dict(cur, row)


def _installment_lines_rows(cur: Any, installment_id: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT id, seq, principal, interest, payment_total
        FROM installment_line
        WHERE installment_id = ?
        ORDER BY seq ASC
        """,
        (installment_id,),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _installment_detail(cur: Any, installment_id: int) -> dict[str, Any] | None:
    """Header + lines, fetched as two plain queries and combined in Python."""
    header = _installment_row_dict(cur, installment_id)
    if header is None:
        return None
    return {"installment": header, "lines": _installment_lines_rows(cur, installment_id)}


def get_installment(installment_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            return _installment_row_dict(cur, installment_id)


def fetch_installment_with_lines(
    installment_id: int,
) -> dict[str, Any] | None:
    """Single transaction: installment row + schedule lines."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            return _installment_detail(cur, installment_id)


def insert_installment(
    name: str,
    installment_current: int,
    installment_total: int,
    principal: float,
    interest: float | None,
    payment_total: float,
    start_date: Any,
    finish_date: Any,
    remaining: float,
    original_total: float,
    credit_card_id: int | None = None,
) -> dict[str, Any]:
    """Insert + seed lines + return ``{installment, lines}`` (skips a follow-up GET)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO installment (
                    name, installment_current, installment_total,
                    principal, interest, payment_total,
                    start_date, finish_date, remaining, original_total, credit_card_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """,
                (
                    name,
                    installment_current,
                    installment_total,
                    principal,
                    interest,
                    payment_total,
                    start_date,
                    finish_date,
                    remaining,
                    original_total,
                    credit_card_id,
                ),
            )
            iid = int(cur.fetchone()[0])
            _seed_installment_lines(cur, iid, installment_total, principal, interest)
            _recompute_installment_aggregates(cur, iid)
            detail = _installment_detail(cur, iid)
            assert detail is not None
            return detail


def _line_payment_total(principal: float, interest: float | None) -> float:
    return float(principal) + (float(interest) if interest is not None else 0.0)


def _seed_installment_lines(
    cur: Any,
    installment_id: int,
    installment_total: int,
    principal: float,
    interest: float | None,
) -> None:
    """Insert seq 1..N in one batch."""
    n = int(installment_total)
    if n <= 0:
        return
    ptot = _line_payment_total(principal, interest)
    cur.executemany(
        """
        INSERT INTO installment_line (installment_id, seq, principal, interest, payment_total)
        VALUES (?, ?, ?, ?, ?)
        """,
        [(installment_id, seq, principal, interest, ptot) for seq in range(1, n + 1)],
    )


def list_installment_lines(installment_id: int) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            return _installment_lines_rows(cur, installment_id)


def _recompute_installment_aggregates(cur: Any, installment_id: int) -> None:
    """
    Recompute ``original_total`` / ``remaining`` and (if a line exists at
    ``installment_current``) the cached ``principal`` / ``interest`` /
    ``payment_total`` columns. Single SELECT pulls everything we need; a
    single UPDATE applies it.
    """
    cur.execute(
        """
        SELECT
            (SELECT COALESCE(SUM(principal), 0)
               FROM installment_line WHERE installment_id = i.id)             AS sum_p,
            (SELECT COALESCE(SUM(payment_total), 0)
               FROM installment_line
               WHERE installment_id = i.id AND seq >= i.installment_current)  AS sum_pt_rem,
            cl.principal,
            cl.interest,
            cl.payment_total,
            (cl.installment_id IS NOT NULL)                                   AS has_current_line
        FROM installment i
        LEFT JOIN installment_line cl
            ON cl.installment_id = i.id AND cl.seq = i.installment_current
        WHERE i.id = ?
        """,
        (installment_id,),
    )
    row = cur.fetchone()
    if not row:
        return
    sum_p, sum_pt_rem, cl_p, cl_i, cl_pt, has_line = row
    if has_line:
        cur.execute(
            """
            UPDATE installment SET
                original_total = ?,
                remaining = ?,
                principal = ?,
                interest = ?,
                payment_total = ?
            WHERE id = ?
            """,
            (
                float(sum_p),
                float(sum_pt_rem),
                cl_p,
                cl_i,
                float(cl_pt),
                installment_id,
            ),
        )
    else:
        cur.execute(
            """
            UPDATE installment SET original_total = ?, remaining = ?
            WHERE id = ?
            """,
            (float(sum_p), float(sum_pt_rem), installment_id),
        )


def update_installment_line(
    installment_id: int,
    seq: int,
    principal: float,
    interest: float | None,
) -> bool:
    ptot = _line_payment_total(principal, interest)
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE installment_line SET
                    principal = ?,
                    interest = ?,
                    payment_total = ?
                WHERE installment_id = ? AND seq = ?
                """,
                (principal, interest, ptot, installment_id, seq),
            )
            if cur.rowcount == 0:
                return False
            _recompute_installment_aggregates(cur, installment_id)
            return True


def update_installment_line_and_fetch_detail(
    installment_id: int,
    seq: int,
    principal: float,
    interest: float | None,
) -> dict[str, Any] | None:
    """UPDATE line, recompute aggregates, return ``{installment, lines}``."""
    ptot = _line_payment_total(principal, interest)
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE installment_line SET
                    principal = ?,
                    interest = ?,
                    payment_total = ?
                WHERE installment_id = ? AND seq = ?
                """,
                (principal, interest, ptot, installment_id, seq),
            )
            if cur.rowcount == 0:
                return None
            _recompute_installment_aggregates(cur, installment_id)
            return _installment_detail(cur, installment_id)


def update_installment_lines_bulk(
    installment_id: int,
    items: list[tuple[int, float, float | None]],
) -> dict[str, Any] | None:
    """UPDATE many lines (by seq), then recompute aggregates once."""
    if not items:
        return None
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            updated_any = False
            for seq, principal, interest in items:
                ptot = _line_payment_total(principal, interest)
                cur.execute(
                    """
                    UPDATE installment_line
                    SET principal = ?, interest = ?, payment_total = ?
                    WHERE installment_id = ? AND seq = ?
                    """,
                    (principal, interest, ptot, installment_id, int(seq)),
                )
                if cur.rowcount > 0:
                    updated_any = True
            if not updated_any:
                return None
            _recompute_installment_aggregates(cur, installment_id)
            return _installment_detail(cur, installment_id)


def reorder_installment_lines(
    installment_id: int,
    ordered_line_ids: list[int],
) -> dict[str, Any] | None:
    """
    Renumber ``seq`` so rows appear in ``ordered_line_ids`` order (top → bottom).
    Returns None if ``ordered_line_ids`` is not exactly the set of line ids for this plan.
    """
    if not ordered_line_ids:
        return None
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id FROM installment_line
                WHERE installment_id = ?
                ORDER BY seq ASC
                """,
                (installment_id,),
            )
            existing_ids = [r[0] for r in cur.fetchall()]
            if len(ordered_line_ids) != len(existing_ids):
                return None
            if set(ordered_line_ids) != set(existing_ids):
                return None
            # First, push every seq into a non-overlapping range so the following
            # per-row UPDATEs can renumber freely without violating the
            # ``UNIQUE (installment_id, seq)`` constraint mid-statement.
            cur.execute(
                "UPDATE installment_line SET seq = id + 1000000 WHERE installment_id = ?",
                (installment_id,),
            )
            for i, lid in enumerate(ordered_line_ids):
                cur.execute(
                    "UPDATE installment_line SET seq = ? WHERE installment_id = ? AND id = ?",
                    (i + 1, installment_id, int(lid)),
                )
            _recompute_installment_aggregates(cur, installment_id)
            return _installment_detail(cur, installment_id)


def _resync_installment_lines_on_total_change(
    cur: Any,
    installment_id: int,
    new_total: int,
    principal: float,
    interest: float | None,
) -> None:
    """
    Truncate the schedule to ``new_total`` rows and (re)apply the per-line
    amounts. A DELETE for any rows past the new tail, plus an UPSERT that
    creates or updates seq 1..new_total.
    """
    n = int(new_total)
    ptot = _line_payment_total(principal, interest)
    cur.execute(
        "DELETE FROM installment_line WHERE installment_id = ? AND seq > ?",
        (installment_id, n),
    )
    if n <= 0:
        return
    cur.executemany(
        """
        INSERT INTO installment_line (installment_id, seq, principal, interest, payment_total)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (installment_id, seq) DO UPDATE SET
            principal = excluded.principal,
            interest = excluded.interest,
            payment_total = excluded.payment_total
        """,
        [(installment_id, seq, principal, interest, ptot) for seq in range(1, n + 1)],
    )


def update_installment(
    installment_id: int,
    name: str,
    installment_current: int,
    installment_total: int,
    principal: float,
    interest: float | None,
    payment_total: float,
    start_date: Any,
    finish_date: Any,
    remaining: float,
    original_total: float,
    credit_card_id: int | None = None,
) -> dict[str, Any] | None:
    """Update + (re)seed lines if total changed + return ``{installment, lines}`` (or ``None``)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                SELECT installment_total,
                       (SELECT COUNT(*) FROM installment_line
                          WHERE installment_id = installment.id)
                FROM installment WHERE id = ?
                """,
                (installment_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            old_total, line_count = int(row[0] or 0), int(row[1] or 0)
            cur.execute(
                """
                UPDATE installment SET
                    name = ?,
                    installment_current = ?,
                    installment_total = ?,
                    principal = ?,
                    interest = ?,
                    payment_total = ?,
                    start_date = ?,
                    finish_date = ?,
                    remaining = ?,
                    original_total = ?,
                    credit_card_id = ?
                WHERE id = ?
                """,
                (
                    name,
                    installment_current,
                    installment_total,
                    principal,
                    interest,
                    payment_total,
                    start_date,
                    finish_date,
                    remaining,
                    original_total,
                    credit_card_id,
                    installment_id,
                ),
            )
            has_lines = line_count > 0
            if has_lines and old_total != int(installment_total):
                _resync_installment_lines_on_total_change(
                    cur, installment_id, installment_total, principal, interest
                )
            if has_lines:
                _recompute_installment_aggregates(cur, installment_id)
            return _installment_detail(cur, installment_id)


def delete_installment(installment_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM installment WHERE id = ?", (installment_id,))
            return cur.rowcount > 0


def installment_apply_payment(installment_id: int) -> dict[str, Any] | None:
    """Advance ``installment_current`` by one and return the refreshed header row.

    Reads the current state (including line count) first; only advances when
    there's a payment left to apply (``installment_current <= installment_total``
    and ``remaining > 0``) — otherwise returns ``None`` without changing anything.
    """
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                SELECT installment_current, installment_total, payment_total, remaining,
                       (SELECT COUNT(*) FROM installment_line il
                          WHERE il.installment_id = installment.id)
                FROM installment WHERE id = ?
                """,
                (installment_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            current, total, pay, rem, line_count = row
            current, total, line_count = int(current), int(total), int(line_count or 0)
            rem = float(rem or 0)
            pay = float(pay or 0)
            if not (current <= total and rem > 0):
                return None
            cur.execute(
                "UPDATE installment SET installment_current = installment_current + 1 WHERE id = ?",
                (installment_id,),
            )
            if line_count > 0:
                _recompute_installment_aggregates(cur, installment_id)
            else:
                new_rem = max(0.0, rem - pay)
                cur.execute(
                    "UPDATE installment SET remaining = ? WHERE id = ?",
                    (new_rem, installment_id),
                )
            return _installment_row_dict(cur, installment_id)


_HOUSE_PAYMENT_SELECT = """
    SELECT h.id, h.name, h.notes, h.created_at,
           COALESCE(e.entry_count, 0) AS entry_count,
           COALESCE(e.total_paid, 0) AS total_paid,
           e.last_paid_on
    FROM house_payment h
    LEFT JOIN (
        SELECT house_payment_id,
               COUNT(*) AS entry_count,
               COALESCE(SUM(amount), 0) AS total_paid,
               MAX(paid_on) AS last_paid_on
        FROM house_payment_entry
        GROUP BY house_payment_id
    ) AS e ON e.house_payment_id = h.id
"""


def _house_payment_row_dict(
    cur: Any, house_payment_id: int
) -> dict[str, Any] | None:
    """Read one plan including its joined ``entry_count``/``total_paid``/``last_paid_on``."""
    cur.execute(
        f"{_HOUSE_PAYMENT_SELECT} WHERE h.id = ?",
        (house_payment_id,),
    )
    row = cur.fetchone()
    return _row_to_dict(cur, row) if row else None


def _house_payment_entries_rows(
    cur: Any, house_payment_id: int
) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT id, paid_on, amount, created_at
        FROM house_payment_entry
        WHERE house_payment_id = ?
        ORDER BY paid_on DESC, id DESC
        """,
        (house_payment_id,),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _house_payment_detail(
    cur: Any, house_payment_id: int
) -> dict[str, Any] | None:
    """Plan header (with aggregates) + entries, fetched as two plain queries."""
    header = _house_payment_row_dict(cur, house_payment_id)
    if header is None:
        return None
    return {
        "house_payment": header,
        "entries": _house_payment_entries_rows(cur, house_payment_id),
    }


def list_house_payments(limit: int = 500) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                {_HOUSE_PAYMENT_SELECT}
                ORDER BY h.name ASC, h.id ASC
                LIMIT ?
                """,
                (limit,),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]


def get_house_payment(house_payment_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            return _house_payment_row_dict(cur, house_payment_id)


def fetch_house_payment_with_entries(
    house_payment_id: int,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            return _house_payment_detail(cur, house_payment_id)


def insert_house_payment(name: str, notes: str | None) -> dict[str, Any]:
    """Insert a plan and return the full row (zero-aggregated)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO house_payment (name, notes)
                VALUES (?, ?)
                RETURNING id, name, notes, created_at
                """,
                (name, notes),
            )
            row = _row_to_dict(cur, cur.fetchone())
            row["entry_count"] = 0
            row["total_paid"] = 0.0
            row["last_paid_on"] = None
            return row


def update_house_payment(
    house_payment_id: int, name: str, notes: str | None
) -> dict[str, Any] | None:
    """Update the plan and return the full row (or ``None`` if not found)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE house_payment SET name = ?, notes = ?
                WHERE id = ?
                RETURNING id
                """,
                (name, notes, house_payment_id),
            )
            if not cur.fetchone():
                return None
            return _house_payment_row_dict(cur, house_payment_id)


def delete_house_payment(house_payment_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "DELETE FROM house_payment WHERE id = ?", (house_payment_id,)
            )
            return cur.rowcount > 0


def insert_house_payment_entry(
    house_payment_id: int, paid_on: Any, amount: float
) -> dict[str, Any] | None:
    """Insert one payment entry and return the refreshed plan detail (header + entries)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO house_payment_entry (house_payment_id, paid_on, amount)
                SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM house_payment WHERE id = ?)
                RETURNING id
                """,
                (house_payment_id, paid_on, amount, house_payment_id),
            )
            if not cur.fetchone():
                return None
            return _house_payment_detail(cur, house_payment_id)


def update_house_payment_entry(
    house_payment_id: int, entry_id: int, paid_on: Any, amount: float
) -> dict[str, Any] | None:
    """Update one entry and return the refreshed plan detail."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE house_payment_entry SET paid_on = ?, amount = ?
                WHERE id = ? AND house_payment_id = ?
                RETURNING id
                """,
                (paid_on, amount, entry_id, house_payment_id),
            )
            if not cur.fetchone():
                return None
            return _house_payment_detail(cur, house_payment_id)


def delete_house_payment_entry(
    house_payment_id: int, entry_id: int
) -> dict[str, Any] | None:
    """Delete one entry and return the refreshed plan detail (or ``None``)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                DELETE FROM house_payment_entry
                WHERE id = ? AND house_payment_id = ?
                RETURNING id
                """,
                (entry_id, house_payment_id),
            )
            if not cur.fetchone():
                return None
            return _house_payment_detail(cur, house_payment_id)


_BLOOD_PRESSURE_COLS = "id, systolic, diastolic, pulse, spo2, temperature, weight, notes, created_at"


def list_blood_pressures(limit: int = 500) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_BLOOD_PRESSURE_COLS} FROM blood_pressure
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


def insert_blood_pressure(
    systolic: int | None,
    diastolic: int | None,
    pulse: int | None,
    spo2: int | None,
    temperature: float | None,
    weight: float | None,
    notes: str | None,
) -> dict[str, Any]:
    """Insert one reading (timestamped now) and return the full row."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO blood_pressure (systolic, diastolic, pulse, spo2, temperature, weight, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING {_BLOOD_PRESSURE_COLS}
                """,
                (systolic, diastolic, pulse, spo2, temperature, weight, notes),
            )
            return _row_to_dict(cur, cur.fetchone())


def update_blood_pressure(
    reading_id: int,
    systolic: int | None,
    diastolic: int | None,
    pulse: int | None,
    spo2: int | None,
    temperature: float | None,
    weight: float | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                UPDATE blood_pressure
                SET systolic = ?, diastolic = ?, pulse = ?, spo2 = ?,
                    temperature = ?, weight = ?, notes = ?
                WHERE id = ?
                RETURNING {_BLOOD_PRESSURE_COLS}
                """,
                (systolic, diastolic, pulse, spo2, temperature, weight, notes, reading_id),
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def delete_blood_pressure(reading_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM blood_pressure WHERE id = ?", (reading_id,))
            return cur.rowcount > 0


_FIXED_EXPENSE_COLS = "id, period_half, period_year, period_month, amount, description, created_at"


def list_fixed_expenses(
    period_half: int | None = None,
    period_year: int | None = None,
    period_month: int | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            clauses = []
            params: list[Any] = []
            if period_half is not None:
                clauses.append("period_half = ?")
                params.append(period_half)
            if period_year is not None:
                clauses.append("period_year = ?")
                params.append(period_year)
            if period_month is not None:
                clauses.append("period_month = ?")
                params.append(period_month)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            params.append(limit)
            cur.execute(
                f"""
                SELECT {_FIXED_EXPENSE_COLS} FROM fixed_expense
                {where}
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                params,
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


def insert_fixed_expense(
    period_half: int,
    amount: float,
    description: str | None,
    period_year: int,
    period_month: int,
) -> dict[str, Any]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO fixed_expense (period_half, period_year, period_month, amount, description)
                VALUES (?, ?, ?, ?, ?)
                RETURNING {_FIXED_EXPENSE_COLS}
                """,
                (period_half, period_year, period_month, amount, description),
            )
            return _row_to_dict(cur, cur.fetchone())


def delete_fixed_expense(expense_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM fixed_expense WHERE id = ?", (expense_id,))
            return cur.rowcount > 0


_MONTHLY_EXPENSE_COLS = (
    "id, name, description, amount, period_half, period_year, period_month, "
    "is_recurring, created_at"
)


def list_monthly_expenses(
    period_half: int | None = None,
    period_year: int | None = None,
    period_month: int | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """
    ``period_year``/``period_month`` scope the result to a single calendar
    month (used by the calendar page), but a row with ``is_recurring`` set
    always matches regardless of its own period, since it's meant to show up
    every month.
    """
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            clauses = []
            params: list[Any] = []
            if period_half is not None:
                clauses.append("period_half = ?")
                params.append(period_half)
            if period_year is not None and period_month is not None:
                clauses.append("(is_recurring = TRUE OR (period_year = ? AND period_month = ?))")
                params.extend([period_year, period_month])
            elif period_year is not None:
                clauses.append("(is_recurring = TRUE OR period_year = ?)")
                params.append(period_year)
            elif period_month is not None:
                clauses.append("(is_recurring = TRUE OR period_month = ?)")
                params.append(period_month)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            params.append(limit)
            cur.execute(
                f"""
                SELECT {_MONTHLY_EXPENSE_COLS} FROM monthly_expense
                {where}
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                tuple(params),
            )
            return [_with_bool(_row_to_dict(cur, r), "is_recurring") for r in cur.fetchall()]


def insert_monthly_expense(
    name: str,
    description: str | None,
    amount: float,
    period_half: int,
    period_year: int,
    period_month: int,
    is_recurring: bool = False,
) -> dict[str, Any]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO monthly_expense
                    (name, description, amount, period_half, period_year, period_month,
                     is_recurring)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING {_MONTHLY_EXPENSE_COLS}
                """,
                (name, description, amount, period_half, period_year, period_month, is_recurring),
            )
            return _with_bool(_row_to_dict(cur, cur.fetchone()), "is_recurring")


def update_monthly_expense(
    expense_id: int,
    name: str,
    description: str | None,
    amount: float,
    period_half: int,
    period_year: int,
    period_month: int,
    is_recurring: bool = False,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                UPDATE monthly_expense
                SET name = ?, description = ?, amount = ?, period_half = ?,
                    period_year = ?, period_month = ?, is_recurring = ?
                WHERE id = ?
                RETURNING {_MONTHLY_EXPENSE_COLS}
                """,
                (
                    name,
                    description,
                    amount,
                    period_half,
                    period_year,
                    period_month,
                    is_recurring,
                    expense_id,
                ),
            )
            row = cur.fetchone()
            return _with_bool(_row_to_dict(cur, row), "is_recurring") if row else None


def delete_monthly_expense(expense_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM monthly_expense WHERE id = ?", (expense_id,))
            return cur.rowcount > 0


_CREDIT_CARD_COLS = (
    "id, name, credit_limit, last_statement_balance, current_balance, "
    "minimum_due, interest_rate, statement_date, due_date, created_at"
)


def get_credit_card() -> dict[str, Any] | None:
    """The single credit card record, if one has been set up."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"SELECT {_CREDIT_CARD_COLS} FROM credit_card ORDER BY id LIMIT 1"
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def insert_credit_card(
    name: str,
    credit_limit: float,
    last_statement_balance: float,
    minimum_due: float,
    interest_rate: float,
    statement_date: Any,
    due_date: Any,
) -> dict[str, Any]:
    """``current_balance`` starts equal to the statement balance being recorded."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO credit_card (
                    name, credit_limit, last_statement_balance, current_balance,
                    minimum_due, interest_rate, statement_date, due_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING {_CREDIT_CARD_COLS}
                """,
                (
                    name,
                    credit_limit,
                    last_statement_balance,
                    last_statement_balance,
                    minimum_due,
                    interest_rate,
                    statement_date,
                    due_date,
                ),
            )
            return _row_to_dict(cur, cur.fetchone())


def update_credit_card(
    card_id: int,
    name: str,
    credit_limit: float,
    last_statement_balance: float,
    minimum_due: float,
    interest_rate: float,
    statement_date: Any,
    due_date: Any,
) -> dict[str, Any] | None:
    """Full replace; resets ``current_balance`` to the new statement balance (a fresh cycle)."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                UPDATE credit_card SET
                    name = ?,
                    credit_limit = ?,
                    last_statement_balance = ?,
                    current_balance = ?,
                    minimum_due = ?,
                    interest_rate = ?,
                    statement_date = ?,
                    due_date = ?
                WHERE id = ?
                RETURNING {_CREDIT_CARD_COLS}
                """,
                (
                    name,
                    credit_limit,
                    last_statement_balance,
                    last_statement_balance,
                    minimum_due,
                    interest_rate,
                    statement_date,
                    due_date,
                    card_id,
                ),
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def adjust_credit_card_balance(
    card_id: int, current_balance: float
) -> dict[str, Any] | None:
    """
    Directly set ``current_balance`` without touching the statement fields.

    Used to reconcile against the bank's real available credit when purchases
    or other transactions happened that this app never recorded as payments.
    """
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                UPDATE credit_card SET current_balance = ?
                WHERE id = ?
                RETURNING {_CREDIT_CARD_COLS}
                """,
                (current_balance, card_id),
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def delete_credit_card(card_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM credit_card WHERE id = ?", (card_id,))
            return cur.rowcount > 0


_CREDIT_CARD_PAYMENT_COLS = "id, credit_card_id, amount, payment_date, note, created_at"


def list_credit_card_payments(credit_card_id: int) -> list[dict[str, Any]]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_CREDIT_CARD_PAYMENT_COLS} FROM credit_card_payment
                WHERE credit_card_id = ?
                ORDER BY payment_date DESC, id DESC
                """,
                (credit_card_id,),
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


def insert_credit_card_payment(
    credit_card_id: int, amount: float, payment_date: Any, note: str | None
) -> dict[str, Any] | None:
    """Insert the payment and decrement the card's ``current_balance`` in one transaction."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("SELECT 1 FROM credit_card WHERE id = ?", (credit_card_id,))
            if not cur.fetchone():
                return None
            cur.execute(
                f"""
                INSERT INTO credit_card_payment (credit_card_id, amount, payment_date, note)
                VALUES (?, ?, ?, ?)
                RETURNING {_CREDIT_CARD_PAYMENT_COLS}
                """,
                (credit_card_id, amount, payment_date, note),
            )
            payment = _row_to_dict(cur, cur.fetchone())
            cur.execute(
                "UPDATE credit_card SET current_balance = current_balance - ? WHERE id = ?",
                (amount, credit_card_id),
            )
            return payment


def delete_credit_card_payment(payment_id: int) -> bool:
    """Delete the payment and restore its amount to the card's balance."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "DELETE FROM credit_card_payment WHERE id = ? RETURNING credit_card_id, amount",
                (payment_id,),
            )
            row = cur.fetchone()
            if not row:
                return False
            credit_card_id, amount = row
            cur.execute(
                "UPDATE credit_card SET current_balance = current_balance + ? WHERE id = ?",
                (amount, credit_card_id),
            )
            return True


_CALENDAR_DAY_OVERRIDE_COLS = "id, day, amount, created_at"


def list_calendar_day_overrides() -> list[dict[str, Any]]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"SELECT {_CALENDAR_DAY_OVERRIDE_COLS} FROM calendar_day_override ORDER BY day"
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


def upsert_calendar_day_overrides(
    overrides: list[tuple[str, float]],
) -> list[dict[str, Any]]:
    """Upsert one or more (day, amount) pairs in a single transaction and return the full list."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            for day, amount in overrides:
                cur.execute(
                    """
                    INSERT INTO calendar_day_override (day, amount)
                    VALUES (?, ?)
                    ON CONFLICT (day) DO UPDATE SET amount = excluded.amount
                    """,
                    (day, amount),
                )
            cur.execute(
                f"SELECT {_CALENDAR_DAY_OVERRIDE_COLS} FROM calendar_day_override ORDER BY day"
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


_PP_START_OVERRIDE_COLS = "id, period_year, period_month, period_half, start_date, created_at"


def list_pay_period_start_overrides() -> list[dict[str, Any]]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_PP_START_OVERRIDE_COLS} FROM pay_period_start_override
                ORDER BY period_year, period_month, period_half
                """
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


def get_pay_period_start_override(
    period_year: int, period_month: int, period_half: int
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_PP_START_OVERRIDE_COLS} FROM pay_period_start_override
                WHERE period_year = ? AND period_month = ? AND period_half = ?
                """,
                (period_year, period_month, period_half),
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def upsert_pay_period_start_override(
    period_year: int, period_month: int, period_half: int, start_date: str
) -> dict[str, Any]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO pay_period_start_override
                    (period_year, period_month, period_half, start_date)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (period_year, period_month, period_half)
                    DO UPDATE SET start_date = excluded.start_date
                RETURNING {_PP_START_OVERRIDE_COLS}
                """,
                (period_year, period_month, period_half, start_date),
            )
            return _row_to_dict(cur, cur.fetchone())


def delete_pay_period_start_override(
    period_year: int, period_month: int, period_half: int
) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                DELETE FROM pay_period_start_override
                WHERE period_year = ? AND period_month = ? AND period_half = ?
                RETURNING id
                """,
                (period_year, period_month, period_half),
            )
            return cur.fetchone() is not None


_PAYSLIP_DEFAULT_FORM_COLS = (
    "period_year",
    "period_month",
    "total",
    "basic_salary",
    "commission",
    "reimbursement",
    "medical_reimbursement",
    "others",
    "mp2",
    "allowances",
    "thirteenth_month",
    "notes",
    "withholding_tax",
    "sss_contribution",
    "philhealth",
    "pag_ibig",
)


def _payslip_default_row_to_form(row: dict[str, Any] | None, half: int) -> dict[str, Any] | None:
    if row is None:
        return None
    out = {k: row.get(k) or "" for k in _PAYSLIP_DEFAULT_FORM_COLS}
    out["period_half"] = str(half)
    return out


def get_payslip_defaults() -> dict[str, Any]:
    """Saved Settings → Payslip defaults templates, keyed by half (1st/2nd).

    Returns ``None`` for a half or for ``settings_half`` when nothing has
    been saved yet — the router fills in the builtin fallback."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"SELECT half, {', '.join(_PAYSLIP_DEFAULT_FORM_COLS)} FROM payslip_default"
            )
            rows_by_half = {
                r["half"]: r for r in (_row_to_dict(cur, row) for row in cur.fetchall())
            }
            cur.execute("SELECT settings_half FROM payslip_default_settings WHERE id = 1")
            settings_row = cur.fetchone()
            settings_half = _row_to_dict(cur, settings_row)["settings_half"] if settings_row else None
    return {
        "form_first": _payslip_default_row_to_form(rows_by_half.get(1), 1),
        "form_second": _payslip_default_row_to_form(rows_by_half.get(2), 2),
        "settings_half": settings_half,
    }


def save_payslip_defaults(
    form_first: dict[str, Any], form_second: dict[str, Any], settings_half: str
) -> None:
    """Upsert both half templates and the active-half toggle in one transaction."""
    cols_sql = ", ".join(_PAYSLIP_DEFAULT_FORM_COLS)
    placeholders_sql = ", ".join("?" for _ in _PAYSLIP_DEFAULT_FORM_COLS)
    updates_sql = ", ".join(f"{c} = excluded.{c}" for c in _PAYSLIP_DEFAULT_FORM_COLS)
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            for half, form in ((1, form_first), (2, form_second)):
                values = [str(form.get(c) or "") for c in _PAYSLIP_DEFAULT_FORM_COLS]
                cur.execute(
                    f"""
                    INSERT INTO payslip_default (half, {cols_sql})
                    VALUES (?, {placeholders_sql})
                    ON CONFLICT (half) DO UPDATE SET {updates_sql}
                    """,
                    (half, *values),
                )
            cur.execute(
                """
                INSERT INTO payslip_default_settings (id, settings_half)
                VALUES (1, ?)
                ON CONFLICT (id) DO UPDATE SET settings_half = excluded.settings_half
                """,
                (settings_half,),
            )


_LOTTO_DRAW_COLS = (
    "id, draw_date, n1, n2, n3, n4, n5, n6, jackpot_prize, winners, created_at"
)
_LOTTO_ATTEMPT_COLS = "id, draw_id, ticket, n1, n2, n3, n4, n5, n6, hidden, created_at"


def _lotto_attempts_rows(cur: Any, draw_id: int) -> list[dict[str, Any]]:
    cur.execute(
        f"""
        SELECT {_LOTTO_ATTEMPT_COLS} FROM lotto_attempt
        WHERE draw_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (draw_id,),
    )
    return [_row_to_dict(cur, r) for r in cur.fetchall()]


def _lotto_draw_detail(cur: Any, draw_id: int) -> dict[str, Any] | None:
    cur.execute(
        f"SELECT {_LOTTO_DRAW_COLS} FROM lotto_draw WHERE id = ?",
        (draw_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    draw = _row_to_dict(cur, row)
    return {"draw": draw, "attempts": _lotto_attempts_rows(cur, draw_id)}


def list_lotto_draws(limit: int = 200) -> list[dict[str, Any]]:
    """Every draw (newest first), each with its attempts nested."""
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_LOTTO_DRAW_COLS} FROM lotto_draw
                ORDER BY draw_date DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            )
            draws = [_row_to_dict(cur, r) for r in cur.fetchall()]
            if not draws:
                return []
            ids = [d["id"] for d in draws]
            cur.execute(
                f"""
                SELECT {_LOTTO_ATTEMPT_COLS} FROM lotto_attempt
                WHERE draw_id IN ({",".join("?" * len(ids))})
                ORDER BY created_at ASC, id ASC
                """,
                ids,
            )
            attempts_by_draw: dict[int, list[dict[str, Any]]] = {}
            for r in cur.fetchall():
                a = _row_to_dict(cur, r)
                attempts_by_draw.setdefault(a["draw_id"], []).append(a)
            return [
                {"draw": d, "attempts": attempts_by_draw.get(d["id"], [])}
                for d in draws
            ]


def upsert_lotto_draw(
    draw_date: Any,
    numbers: list[int] | None,
    jackpot_prize: float | None = None,
    winners: int = 0,
) -> dict[str, Any]:
    """Create the result for a date, or overwrite it if one already exists.
    ``numbers`` may be None to log just the date before the result is known.
    Overwrites ``jackpot_prize``/``winners`` too, same as the numbers — posting
    the same date again replaces that date's result wholesale."""
    n1, n2, n3, n4, n5, n6 = numbers if numbers is not None else (None,) * 6
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO lotto_draw (draw_date, n1, n2, n3, n4, n5, n6, jackpot_prize, winners)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (draw_date) DO UPDATE SET
                    n1 = excluded.n1, n2 = excluded.n2, n3 = excluded.n3,
                    n4 = excluded.n4, n5 = excluded.n5, n6 = excluded.n6,
                    jackpot_prize = excluded.jackpot_prize, winners = excluded.winners
                RETURNING id
                """,
                (draw_date, n1, n2, n3, n4, n5, n6, jackpot_prize, winners),
            )
            draw_id = cur.fetchone()[0]
            return _lotto_draw_detail(cur, draw_id)


def upsert_lotto_draws_bulk(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Bulk-upsert draws by date in one transaction (the whole batch commits or
    none of it does) — used by the historic-results text import. Each row:
    ``{"draw_date": iso date str, "numbers": [n1..n6], "jackpot_prize": float | None,
    "winners": int}``. Re-uploading the same date overwrites it, so importing
    the same file twice (or a file that repeats a date) is safe.
    """
    if not rows:
        return {"inserted": 0, "updated": 0, "total": 0}
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            dates = [r["draw_date"] for r in rows]
            placeholders = ",".join("?" * len(dates))
            cur.execute(
                f"SELECT draw_date FROM lotto_draw WHERE draw_date IN ({placeholders})",
                dates,
            )
            seen = {r[0] for r in cur.fetchall()}
            inserted = updated = 0
            for row in rows:
                draw_date = row["draw_date"]
                n1, n2, n3, n4, n5, n6 = row["numbers"]
                cur.execute(
                    """
                    INSERT INTO lotto_draw (draw_date, n1, n2, n3, n4, n5, n6, jackpot_prize, winners)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (draw_date) DO UPDATE SET
                        n1 = excluded.n1, n2 = excluded.n2, n3 = excluded.n3,
                        n4 = excluded.n4, n5 = excluded.n5, n6 = excluded.n6,
                        jackpot_prize = excluded.jackpot_prize, winners = excluded.winners
                    """,
                    (
                        draw_date,
                        n1,
                        n2,
                        n3,
                        n4,
                        n5,
                        n6,
                        row.get("jackpot_prize"),
                        row.get("winners", 0),
                    ),
                )
                if draw_date in seen:
                    updated += 1
                else:
                    inserted += 1
                    seen.add(draw_date)
            return {"inserted": inserted, "updated": updated, "total": len(rows)}


def get_lotto_draw_id_by_date(draw_date: Any) -> int | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("SELECT id FROM lotto_draw WHERE draw_date = ?", (draw_date,))
            row = cur.fetchone()
            return row[0] if row else None


def update_lotto_draw(
    draw_id: int,
    draw_date: Any,
    numbers: list[int] | None,
    jackpot_prize: float | None = None,
    winners: int = 0,
) -> dict[str, Any] | None:
    """Update an existing draw's date, numbers, jackpot prize, and winner count
    in place, keeping its id and attempts. ``numbers`` may be None to
    clear/leave the result unset."""
    n1, n2, n3, n4, n5, n6 = numbers if numbers is not None else (None,) * 6
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE lotto_draw SET draw_date = ?, n1 = ?, n2 = ?, n3 = ?, n4 = ?, n5 = ?, n6 = ?,
                    jackpot_prize = ?, winners = ?
                WHERE id = ?
                RETURNING id
                """,
                (draw_date, n1, n2, n3, n4, n5, n6, jackpot_prize, winners, draw_id),
            )
            row = cur.fetchone()
            if row is None:
                return None
            return _lotto_draw_detail(cur, draw_id)


def delete_lotto_draw(draw_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM lotto_draw WHERE id = ?", (draw_id,))
            return cur.rowcount > 0


def insert_lotto_attempt(
    draw_id: int, numbers: list[int], ticket: int | None = None
) -> dict[str, Any] | None:
    """Add one attempt under a draw and return the refreshed draw detail.
    ``ticket`` groups this attempt with the other board plays on the same
    physical ticket, so the UI can cluster them; leave it None otherwise."""
    n1, n2, n3, n4, n5, n6 = numbers
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO lotto_attempt (draw_id, ticket, n1, n2, n3, n4, n5, n6)
                SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM lotto_draw WHERE id = ?)
                RETURNING id
                """,
                (draw_id, ticket, n1, n2, n3, n4, n5, n6, draw_id),
            )
            if not cur.fetchone():
                return None
            return _lotto_draw_detail(cur, draw_id)


def update_lotto_attempt(
    draw_id: int, attempt_id: int, numbers: list[int], ticket: int | None = None
) -> dict[str, Any] | None:
    n1, n2, n3, n4, n5, n6 = numbers
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE lotto_attempt SET ticket = ?, n1 = ?, n2 = ?, n3 = ?, n4 = ?, n5 = ?, n6 = ?
                WHERE id = ? AND draw_id = ?
                RETURNING id
                """,
                (ticket, n1, n2, n3, n4, n5, n6, attempt_id, draw_id),
            )
            if not cur.fetchone():
                return None
            return _lotto_draw_detail(cur, draw_id)


def delete_lotto_attempt(draw_id: int, attempt_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "DELETE FROM lotto_attempt WHERE id = ? AND draw_id = ? RETURNING id",
                (attempt_id, draw_id),
            )
            if not cur.fetchone():
                return None
            return _lotto_draw_detail(cur, draw_id)


def set_lotto_attempt_hidden(
    draw_id: int, attempt_id: int, hidden: bool
) -> dict[str, Any] | None:
    """Hide or unhide an attempt without deleting it."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE lotto_attempt SET hidden = ?
                WHERE id = ? AND draw_id = ?
                RETURNING id
                """,
                (1 if hidden else 0, attempt_id, draw_id),
            )
            if not cur.fetchone():
                return None
            return _lotto_draw_detail(cur, draw_id)


_APP_USER_PUBLIC_COLS = "id, username, created_at"


def any_app_users() -> bool:
    """True once at least one user has been added (Settings → Users).

    Login is opt-in the same way OTP used to be: ``require_session`` (see
    app/deps.py) only starts requiring a session once this flips to True, so
    a fresh checkout stays usable until someone deliberately adds a user.
    """
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("SELECT 1 FROM app_user LIMIT 1")
            return cur.fetchone() is not None


def list_app_users() -> list[dict[str, Any]]:
    """All app users, newest first. Never includes ``password_hash``."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"SELECT {_APP_USER_PUBLIC_COLS} FROM app_user ORDER BY username COLLATE NOCASE ASC"
            )
            return [_row_to_dict(cur, r) for r in cur.fetchall()]


def insert_app_user(username: str, password_hash: str) -> dict[str, Any]:
    """Insert one user and return the public row (no ``password_hash``).

    Raises ``sqlite3.IntegrityError`` if ``username`` (case-insensitively)
    already exists — the caller turns that into a 409.
    """
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                INSERT INTO app_user (username, password_hash)
                VALUES (?, ?)
                RETURNING {_APP_USER_PUBLIC_COLS}
                """,
                (username, password_hash),
            )
            return _row_to_dict(cur, cur.fetchone())


def get_app_user_by_username(username: str) -> dict[str, Any] | None:
    """Full row (including ``password_hash``) for credential checks. Not used
    by any endpoint yet — kept for the login wiring this table is meant for."""
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "SELECT id, username, password_hash, created_at FROM app_user "
                "WHERE username = ? COLLATE NOCASE",
                (username,),
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def update_app_user(
    user_id: int,
    username: str | None,
    password_hash: str | None,
) -> dict[str, Any] | None:
    """Update whichever of ``username``/``password_hash`` is not None and
    return the refreshed public row (or ``None`` if no such user).

    Raises ``sqlite3.IntegrityError`` on a username collision.
    """
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            if username is not None:
                cur.execute(
                    "UPDATE app_user SET username = ? WHERE id = ?",
                    (username, user_id),
                )
            if password_hash is not None:
                cur.execute(
                    "UPDATE app_user SET password_hash = ? WHERE id = ?",
                    (password_hash, user_id),
                )
            cur.execute(
                f"SELECT {_APP_USER_PUBLIC_COLS} FROM app_user WHERE id = ?",
                (user_id,),
            )
            row = cur.fetchone()
            return _row_to_dict(cur, row) if row else None


def delete_app_user(user_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM app_user WHERE id = ?", (user_id,))
            return cur.rowcount > 0


_TRAVEL_TRIP_COLS = "id, title, entry_year, entry_month, entry_month_end, notes, created_at"
_TRAVEL_FLIGHT_COLS = (
    "id, trip_id, flight_number, flight_date, departure_time, arrival_time, "
    "from_location, from_map_url, to_location, to_map_url, notes, created_at"
)
_TRAVEL_ITINERARY_COLS = (
    "id, trip_id, item_date, item_end_date, start_time, end_time, activity, "
    "location_name, location_map_url, notes, created_at"
)
_TRAVEL_ACCOMMODATION_COLS = (
    "id, trip_id, name, checkin_date, checkout_date, checkin_time, checkout_time, "
    "booking_confirmation, instructions, location_name, location_map_url, notes, created_at"
)


def _travel_flights_rows(cur: Any, trip_id: int) -> list[dict[str, Any]]:
    cur.execute(
        f"""
        SELECT {_TRAVEL_FLIGHT_COLS} FROM travel_flight
        WHERE trip_id = ?
        ORDER BY flight_date ASC NULLS LAST, created_at ASC, id ASC
        """,
        (trip_id,),
    )
    return [_row_to_dict(cur, r) for r in cur.fetchall()]


def _travel_itinerary_rows(cur: Any, trip_id: int) -> list[dict[str, Any]]:
    cur.execute(
        f"""
        SELECT {_TRAVEL_ITINERARY_COLS} FROM travel_itinerary
        WHERE trip_id = ?
        ORDER BY item_date ASC, start_time ASC NULLS LAST, created_at ASC, id ASC
        """,
        (trip_id,),
    )
    return [_row_to_dict(cur, r) for r in cur.fetchall()]


def _travel_accommodations_rows(cur: Any, trip_id: int) -> list[dict[str, Any]]:
    cur.execute(
        f"""
        SELECT {_TRAVEL_ACCOMMODATION_COLS} FROM travel_accommodation
        WHERE trip_id = ?
        ORDER BY checkin_date ASC, created_at ASC, id ASC
        """,
        (trip_id,),
    )
    return [_row_to_dict(cur, r) for r in cur.fetchall()]


def _travel_trip_detail(cur: Any, trip_id: int) -> dict[str, Any] | None:
    cur.execute(f"SELECT {_TRAVEL_TRIP_COLS} FROM travel_trip WHERE id = ?", (trip_id,))
    row = cur.fetchone()
    if row is None:
        return None
    trip = _row_to_dict(cur, row)
    return {
        "trip": trip,
        "flights": _travel_flights_rows(cur, trip_id),
        "itinerary": _travel_itinerary_rows(cur, trip_id),
        "accommodations": _travel_accommodations_rows(cur, trip_id),
    }


def list_travel_trips(limit: int = 500) -> list[dict[str, Any]]:
    """Every trip (newest entry-period first), each with its flights,
    itinerary, and accommodations nested — one query per sub-table rather
    than N+1 per-trip queries."""
    limit = max(1, min(limit, 2000))
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT {_TRAVEL_TRIP_COLS} FROM travel_trip
                ORDER BY entry_year DESC, entry_month DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            )
            trips = [_row_to_dict(cur, r) for r in cur.fetchall()]
            if not trips:
                return []
            ids = [t["id"] for t in trips]
            placeholders = ",".join("?" * len(ids))

            cur.execute(
                f"""
                SELECT {_TRAVEL_FLIGHT_COLS} FROM travel_flight
                WHERE trip_id IN ({placeholders})
                ORDER BY flight_date ASC NULLS LAST, created_at ASC, id ASC
                """,
                ids,
            )
            flights_by_trip: dict[int, list[dict[str, Any]]] = {}
            for r in cur.fetchall():
                f = _row_to_dict(cur, r)
                flights_by_trip.setdefault(f["trip_id"], []).append(f)

            cur.execute(
                f"""
                SELECT {_TRAVEL_ITINERARY_COLS} FROM travel_itinerary
                WHERE trip_id IN ({placeholders})
                ORDER BY item_date ASC, start_time ASC NULLS LAST, created_at ASC, id ASC
                """,
                ids,
            )
            itinerary_by_trip: dict[int, list[dict[str, Any]]] = {}
            for r in cur.fetchall():
                i = _row_to_dict(cur, r)
                itinerary_by_trip.setdefault(i["trip_id"], []).append(i)

            cur.execute(
                f"""
                SELECT {_TRAVEL_ACCOMMODATION_COLS} FROM travel_accommodation
                WHERE trip_id IN ({placeholders})
                ORDER BY checkin_date ASC, created_at ASC, id ASC
                """,
                ids,
            )
            accommodations_by_trip: dict[int, list[dict[str, Any]]] = {}
            for r in cur.fetchall():
                a = _row_to_dict(cur, r)
                accommodations_by_trip.setdefault(a["trip_id"], []).append(a)

            return [
                {
                    "trip": t,
                    "flights": flights_by_trip.get(t["id"], []),
                    "itinerary": itinerary_by_trip.get(t["id"], []),
                    "accommodations": accommodations_by_trip.get(t["id"], []),
                }
                for t in trips
            ]


def insert_travel_trip(
    title: str,
    entry_year: int,
    entry_month: int,
    entry_month_end: int,
    notes: str | None,
) -> dict[str, Any]:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO travel_trip (title, entry_year, entry_month, entry_month_end, notes)
                VALUES (?, ?, ?, ?, ?)
                RETURNING id
                """,
                (title, entry_year, entry_month, entry_month_end, notes),
            )
            trip_id = cur.fetchone()[0]
            detail = _travel_trip_detail(cur, trip_id)
            assert detail is not None
            return detail


def update_travel_trip(
    trip_id: int,
    title: str,
    entry_year: int,
    entry_month: int,
    entry_month_end: int,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE travel_trip SET
                    title = ?, entry_year = ?, entry_month = ?, entry_month_end = ?, notes = ?
                WHERE id = ?
                RETURNING id
                """,
                (title, entry_year, entry_month, entry_month_end, notes, trip_id),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def delete_travel_trip(trip_id: int) -> bool:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute("DELETE FROM travel_trip WHERE id = ?", (trip_id,))
            return cur.rowcount > 0


def insert_travel_flight(
    trip_id: int,
    flight_number: str,
    flight_date: Any,
    departure_time: str | None,
    arrival_time: str | None,
    from_location: str | None,
    from_map_url: str | None,
    to_location: str | None,
    to_map_url: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO travel_flight (
                    trip_id, flight_number, flight_date, departure_time, arrival_time,
                    from_location, from_map_url, to_location, to_map_url, notes
                )
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM travel_trip WHERE id = ?)
                RETURNING id
                """,
                (
                    trip_id, flight_number, flight_date, departure_time, arrival_time,
                    from_location, from_map_url, to_location, to_map_url, notes, trip_id,
                ),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def update_travel_flight(
    trip_id: int,
    flight_id: int,
    flight_number: str,
    flight_date: Any,
    departure_time: str | None,
    arrival_time: str | None,
    from_location: str | None,
    from_map_url: str | None,
    to_location: str | None,
    to_map_url: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE travel_flight SET
                    flight_number = ?, flight_date = ?, departure_time = ?, arrival_time = ?,
                    from_location = ?, from_map_url = ?, to_location = ?, to_map_url = ?, notes = ?
                WHERE id = ? AND trip_id = ?
                RETURNING id
                """,
                (
                    flight_number, flight_date, departure_time, arrival_time,
                    from_location, from_map_url, to_location, to_map_url, notes,
                    flight_id, trip_id,
                ),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def delete_travel_flight(trip_id: int, flight_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "DELETE FROM travel_flight WHERE id = ? AND trip_id = ? RETURNING id",
                (flight_id, trip_id),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def insert_travel_itinerary(
    trip_id: int,
    item_date: Any,
    item_end_date: Any,
    start_time: str | None,
    end_time: str | None,
    activity: str,
    location_name: str | None,
    location_map_url: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO travel_itinerary (
                    trip_id, item_date, item_end_date, start_time, end_time, activity,
                    location_name, location_map_url, notes
                )
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM travel_trip WHERE id = ?)
                RETURNING id
                """,
                (
                    trip_id, item_date, item_end_date, start_time, end_time, activity,
                    location_name, location_map_url, notes, trip_id,
                ),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def update_travel_itinerary(
    trip_id: int,
    item_id: int,
    item_date: Any,
    item_end_date: Any,
    start_time: str | None,
    end_time: str | None,
    activity: str,
    location_name: str | None,
    location_map_url: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE travel_itinerary SET
                    item_date = ?, item_end_date = ?, start_time = ?, end_time = ?, activity = ?,
                    location_name = ?, location_map_url = ?, notes = ?
                WHERE id = ? AND trip_id = ?
                RETURNING id
                """,
                (
                    item_date, item_end_date, start_time, end_time, activity,
                    location_name, location_map_url, notes,
                    item_id, trip_id,
                ),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def delete_travel_itinerary(trip_id: int, item_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "DELETE FROM travel_itinerary WHERE id = ? AND trip_id = ? RETURNING id",
                (item_id, trip_id),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def insert_travel_accommodation(
    trip_id: int,
    name: str,
    checkin_date: Any,
    checkout_date: Any,
    checkin_time: str | None,
    checkout_time: str | None,
    booking_confirmation: str | None,
    instructions: str | None,
    location_name: str | None,
    location_map_url: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO travel_accommodation (
                    trip_id, name, checkin_date, checkout_date, checkin_time, checkout_time,
                    booking_confirmation, instructions, location_name, location_map_url, notes
                )
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM travel_trip WHERE id = ?)
                RETURNING id
                """,
                (
                    trip_id, name, checkin_date, checkout_date, checkin_time, checkout_time,
                    booking_confirmation, instructions, location_name, location_map_url, notes,
                    trip_id,
                ),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def update_travel_accommodation(
    trip_id: int,
    accommodation_id: int,
    name: str,
    checkin_date: Any,
    checkout_date: Any,
    checkin_time: str | None,
    checkout_time: str | None,
    booking_confirmation: str | None,
    instructions: str | None,
    location_name: str | None,
    location_map_url: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE travel_accommodation SET
                    name = ?, checkin_date = ?, checkout_date = ?, checkin_time = ?,
                    checkout_time = ?, booking_confirmation = ?, instructions = ?,
                    location_name = ?, location_map_url = ?, notes = ?
                WHERE id = ? AND trip_id = ?
                RETURNING id
                """,
                (
                    name, checkin_date, checkout_date, checkin_time, checkout_time,
                    booking_confirmation, instructions, location_name, location_map_url, notes,
                    accommodation_id, trip_id,
                ),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)


def delete_travel_accommodation(trip_id: int, accommodation_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        with db_cursor(conn) as cur:
            cur.execute(
                "DELETE FROM travel_accommodation WHERE id = ? AND trip_id = ? RETURNING id",
                (accommodation_id, trip_id),
            )
            if not cur.fetchone():
                return None
            return _travel_trip_detail(cur, trip_id)
