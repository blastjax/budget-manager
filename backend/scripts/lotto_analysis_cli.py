"""Command-line entry point for `app.services.lotto_analysis`.

Checks a "historic results" .txt file — the same pipe-delimited shape both
"Import historic results" and "Export historic results" on the Lotto page
use — for patterns in the winning numbers, without needing the app or its
database wired up. Once the same checks are wanted straight from the
database instead, `GET /api/lotto/analysis` runs the identical analysis over
whatever's stored there.

Usage:
    python scripts/lotto_analysis_cli.py path/to/lotto-results.txt
    python scripts/lotto_analysis_cli.py path/to/lotto-results.txt --top 15
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.lotto_analysis import analyze_draws, format_report  # noqa: E402
from app.services.lotto_import import parse_lotto_draw_text  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("file", type=Path, help="Pipe-delimited historic results .txt file")
    parser.add_argument(
        "--top", type=int, default=10, help="How many hot/cold/overdue numbers and pairs to list"
    )
    args = parser.parse_args()

    text = args.file.read_text(encoding="utf-8")
    rows, errors = parse_lotto_draw_text(text)
    if errors:
        print(f"({len(errors)} line(s) couldn't be parsed and were skipped)", file=sys.stderr)
    if not rows:
        sys.exit("No valid draw rows found.")

    # `parse_lotto_draw_text` returns rows in file order — sort oldest-first
    # so "draws since last seen" and the previous-draw repeat count, which
    # both depend on chronological order, come out right regardless of how
    # the file itself was ordered.
    rows.sort(key=lambda r: r.draw_date)
    analysis = analyze_draws([r.numbers for r in rows], top_n=args.top)
    print(format_report(analysis))


if __name__ == "__main__":
    main()
