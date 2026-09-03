"""Patterns in the context around each draw — the jackpot at stake, how many
tickets won it, and when the draw happened.

The winning numbers themselves hold no exploitable pattern (see
``lotto_analysis``): they're drawn independently, so past frequency says
nothing about the next draw. These fields are different, because they're
produced by mechanisms rather than by chance:

  * the jackpot resets to a guaranteed base after a win and rolls over
    otherwise, so its value is mostly a function of how long the current
    streak has run;
  * how many tickets win is driven by how many were sold — which tracks the
    jackpot — and by which combinations players favour;
  * draws run on a fixed weekly schedule, which has been changed over the
    years and interrupted at least once.

The finding here that actually bears on filling in a ticket is the
popularity comparison: multi-winner draws are dominated by combinations
inside the "birthday" range, because that's what players pick. Choosing
outside it can't improve the odds of winning — only the odds of not having
to share.
"""

from __future__ import annotations

import datetime as dt
import math
import statistics
from collections import Counter
from dataclasses import dataclass

from app.services.lotto_analysis import NUMBERS_PER_DRAW, POOL_SIZE, chi_square_p_value

BIRTHDAY_MAX = 31
"""Players overwhelmingly pick calendar dates, so 1-31 is the crowded half of
the pool — the half where winning is most likely to mean sharing."""

WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

# Jackpot size bands for the "do bigger jackpots draw more winners" check.
# Upper bounds in pesos; the last band is open-ended.
JACKPOT_BANDS: tuple[tuple[str, float], ...] = (
    ("under 60M", 60_000_000),
    ("60M - 100M", 100_000_000),
    ("100M - 150M", 150_000_000),
    ("150M - 250M", 250_000_000),
    ("250M+", math.inf),
)


@dataclass
class DrawRecord:
    """One historic draw: everything about it except the user's own attempts."""

    draw_date: dt.date
    numbers: list[int]
    jackpot_prize: float | None
    winners: int


@dataclass
class Bucket:
    """One row of a bucketed breakdown — a label and what landed in it."""

    label: str
    draws: int
    winner_draws: int
    total_winners: int
    mean_jackpot: float | None

    @property
    def win_rate(self) -> float:
        return self.winner_draws / self.draws if self.draws else 0.0


@dataclass
class RolloverStreak:
    """A run of draws from just after one jackpot win through the next one.

    `won` is False for the streak still in progress at the end of the data —
    it has no winning draw yet, so its length is a lower bound.
    """

    start: dt.date
    end: dt.date
    draws: int
    starting_jackpot: float | None
    ending_jackpot: float | None
    won: bool


@dataclass
class HomogeneityTest:
    """Whether the win rate really differs across a set of buckets, or whether
    the spread is what chance would produce anyway.

    `p_value` is the chance of a split at least this uneven if every bucket
    shared one true win rate — so a small value means the breakdown is
    telling you something, and a large one means it isn't.
    """

    label: str
    chi_square: float
    degrees_of_freedom: int
    p_value: float

    @property
    def significant(self) -> bool:
        return self.p_value < 0.05


@dataclass
class PopularityGroup:
    """How "birthday-heavy" the numbers were, for draws grouped by outcome.

    `z_score` measures `mean_birthday_numbers` against what chance alone
    would produce, in standard errors — so it says whether the group's
    numbers really were more crowd-pleasing than a random pick, or just
    look that way on a handful of draws.
    """

    label: str
    draws: int
    mean_birthday_numbers: float
    z_score: float
    mean_jackpot: float | None


@dataclass
class PrizeAnalysis:
    draw_count: int
    first_date: dt.date
    last_date: dt.date
    # Draws whose jackpot was never filled in (null, or a placeholder zero) —
    # excluded from every jackpot figure below.
    missing_jackpot_draws: int

    # Winners
    winner_draws: int
    total_winners: int
    win_rate: float
    winner_count_distribution: list[tuple[int, int]]  # (winners on the draw, how many draws)
    multi_winner_draws: list[DrawRecord]

    # Rollover structure
    streaks: list[RolloverStreak]
    mean_streak_draws: float
    median_streak_draws: float
    longest_streak: RolloverStreak | None
    base_jackpots: list[tuple[dt.date, float]]  # the jackpot each streak opened at
    flat_rollover_draws: int
    growing_rollover_draws: int
    mean_rollover_growth: float
    mean_rollover_growth_pct: float
    max_jackpot: tuple[dt.date, float] | None
    mean_jackpot_when_won: float | None
    mean_jackpot_when_not_won: float | None

    # Jackpot size vs. winners
    jackpot_buckets: list[Bucket]

    # Dates
    weekday_buckets: list[Bucket]
    month_buckets: list[Bucket]
    weekdays_by_year: list[tuple[int, list[str]]]
    largest_gaps: list[tuple[dt.date, dt.date, int]]  # (previous draw, next draw, days apart)

    # Which of the breakdowns above hold up as more than chance
    homogeneity_tests: list[HomogeneityTest]

    # Popularity of the combination vs. how many won on it
    popularity_groups: list[PopularityGroup]
    expected_birthday_numbers: float


def _jackpot(r: DrawRecord) -> float | None:
    """A usable jackpot figure, or None. Zero reads as "never filled in"
    rather than a genuinely empty prize pool, so it counts as missing."""
    if r.jackpot_prize is None or r.jackpot_prize <= 0:
        return None
    return r.jackpot_prize


def _birthday_count(r: DrawRecord) -> int:
    return sum(1 for n in r.numbers if n <= BIRTHDAY_MAX)


def _hypergeometric_mean_sd(pool: int, favourable: int, drawn: int) -> tuple[float, float]:
    """Mean and standard deviation of how many of `favourable` numbers land in
    a `drawn`-number pick from `pool` — i.e. what a fair draw would give."""
    p = favourable / pool
    mean = drawn * p
    variance = drawn * p * (1 - p) * (pool - drawn) / (pool - 1)
    return mean, math.sqrt(variance)


def _win_rate_homogeneity(label: str, buckets: list[Bucket]) -> HomogeneityTest:
    """Chi-square test that every bucket in `buckets` shares one win rate.

    A 2-row contingency test (won / not won against the buckets), computed
    over the buckets themselves so it stays consistent with whatever subset
    they were built from.
    """
    usable = [b for b in buckets if b.draws > 0]
    total_draws = sum(b.draws for b in usable)
    total_wins = sum(b.winner_draws for b in usable)
    if len(usable) < 2 or total_wins == 0 or total_wins == total_draws:
        return HomogeneityTest(label, 0.0, 0, 1.0)
    rate = total_wins / total_draws
    chi_square = 0.0
    for b in usable:
        expected_win = b.draws * rate
        expected_loss = b.draws * (1 - rate)
        chi_square += (b.winner_draws - expected_win) ** 2 / expected_win
        chi_square += ((b.draws - b.winner_draws) - expected_loss) ** 2 / expected_loss
    df = len(usable) - 1
    return HomogeneityTest(label, chi_square, df, chi_square_p_value(chi_square, df))


def _bucket(label: str, rows: list[DrawRecord]) -> Bucket:
    jackpots = [j for j in (_jackpot(r) for r in rows) if j is not None]
    return Bucket(
        label=label,
        draws=len(rows),
        winner_draws=sum(1 for r in rows if r.winners > 0),
        total_winners=sum(r.winners for r in rows),
        mean_jackpot=statistics.fmean(jackpots) if jackpots else None,
    )


def _popularity_group(label: str, rows: list[DrawRecord], expected: float, sd: float) -> PopularityGroup:
    counts = [_birthday_count(r) for r in rows]
    mean = statistics.fmean(counts) if counts else 0.0
    # Standard error of a mean over `len(rows)` independent draws.
    z = (mean - expected) / (sd / math.sqrt(len(rows))) if rows else 0.0
    jackpots = [j for j in (_jackpot(r) for r in rows) if j is not None]
    return PopularityGroup(
        label=label,
        draws=len(rows),
        mean_birthday_numbers=mean,
        z_score=z,
        mean_jackpot=statistics.fmean(jackpots) if jackpots else None,
    )


def _build_streaks(draws: list[DrawRecord]) -> list[RolloverStreak]:
    """Split the history into rollover runs, each ending on the draw that was
    won (bar a trailing run that hasn't been won yet)."""
    streaks: list[RolloverStreak] = []
    start = 0
    for i, d in enumerate(draws):
        if d.winners > 0:
            streaks.append(_make_streak(draws[start : i + 1], won=True))
            start = i + 1
    if start < len(draws):
        streaks.append(_make_streak(draws[start:], won=False))
    return streaks


def _make_streak(run: list[DrawRecord], *, won: bool) -> RolloverStreak:
    return RolloverStreak(
        start=run[0].draw_date,
        end=run[-1].draw_date,
        draws=len(run),
        starting_jackpot=_jackpot(run[0]),
        ending_jackpot=_jackpot(run[-1]),
        won=won,
    )


def analyze_prizes(records: list[DrawRecord], *, top_n: int = 10) -> PrizeAnalysis:
    """Compute every statistic above. `records` may be in any order — they're
    sorted by date here, since almost everything below is about sequence."""
    if not records:
        raise ValueError("Need at least one draw to analyze.")
    draws = sorted(records, key=lambda r: r.draw_date)

    winner_draws = [d for d in draws if d.winners > 0]
    winner_counts = Counter(d.winners for d in draws)

    streaks = _build_streaks(draws)
    completed = [s for s in streaks if s.won]
    streak_lengths = [s.draws for s in completed]

    # Jackpot growth is measured only *within* a streak: the jump between two
    # streaks is a reset to the base, not a rollover, so including it would
    # read as a huge negative "growth".
    growth_abs: list[float] = []
    growth_pct: list[float] = []
    flat = 0
    for streak_run in _streak_runs(draws):
        for prev, nxt in zip(streak_run, streak_run[1:]):
            a, b = _jackpot(prev), _jackpot(nxt)
            if a is None or b is None:
                continue
            if b == a:
                flat += 1
            elif b > a:
                growth_abs.append(b - a)
                growth_pct.append((b - a) / a * 100)

    jackpots_won = [j for j in (_jackpot(d) for d in winner_draws) if j is not None]
    jackpots_lost = [j for j in (_jackpot(d) for d in draws if d.winners == 0) if j is not None]
    dated_jackpots = [(d.draw_date, j) for d in draws if (j := _jackpot(d)) is not None]

    jackpot_buckets: list[Bucket] = []
    remaining = [d for d in draws if _jackpot(d) is not None]
    lower = 0.0
    for label, upper in JACKPOT_BANDS:
        band = [d for d in remaining if lower <= (_jackpot(d) or 0) < upper]
        jackpot_buckets.append(_bucket(label, band))
        lower = upper

    weekday_buckets = [
        _bucket(name, [d for d in draws if d.draw_date.weekday() == i])
        for i, name in enumerate(WEEKDAY_NAMES)
    ]
    weekday_buckets = [b for b in weekday_buckets if b.draws > 0]
    month_buckets = [
        _bucket(dt.date(2000, m, 1).strftime("%B"), [d for d in draws if d.draw_date.month == m])
        for m in range(1, 13)
    ]
    month_buckets = [b for b in month_buckets if b.draws > 0]

    weekdays_by_year: list[tuple[int, list[str]]] = []
    for year in sorted({d.draw_date.year for d in draws}):
        present = sorted(
            {d.draw_date.weekday() for d in draws if d.draw_date.year == year}
        )
        weekdays_by_year.append((year, [WEEKDAY_NAMES[i] for i in present]))

    gaps = [
        (a.draw_date, b.draw_date, (b.draw_date - a.draw_date).days)
        for a, b in zip(draws, draws[1:])
    ]
    largest_gaps = sorted(gaps, key=lambda g: -g[2])[:top_n]

    expected_birthday, birthday_sd = _hypergeometric_mean_sd(
        POOL_SIZE, BIRTHDAY_MAX, NUMBERS_PER_DRAW
    )
    popularity_groups = [
        _popularity_group(
            "no winner", [d for d in draws if d.winners == 0], expected_birthday, birthday_sd
        ),
        _popularity_group(
            "exactly 1 winner", [d for d in draws if d.winners == 1], expected_birthday, birthday_sd
        ),
        _popularity_group(
            "2 or more winners",
            [d for d in draws if d.winners >= 2],
            expected_birthday,
            birthday_sd,
        ),
    ]

    return PrizeAnalysis(
        draw_count=len(draws),
        first_date=draws[0].draw_date,
        last_date=draws[-1].draw_date,
        missing_jackpot_draws=sum(1 for d in draws if _jackpot(d) is None),
        winner_draws=len(winner_draws),
        total_winners=sum(d.winners for d in draws),
        win_rate=len(winner_draws) / len(draws),
        winner_count_distribution=sorted(winner_counts.items()),
        multi_winner_draws=[d for d in draws if d.winners >= 2],
        streaks=streaks,
        mean_streak_draws=statistics.fmean(streak_lengths) if streak_lengths else 0.0,
        median_streak_draws=statistics.median(streak_lengths) if streak_lengths else 0.0,
        longest_streak=max(completed, key=lambda s: s.draws) if completed else None,
        base_jackpots=[
            (s.start, s.starting_jackpot) for s in streaks if s.starting_jackpot is not None
        ],
        flat_rollover_draws=flat,
        growing_rollover_draws=len(growth_abs),
        mean_rollover_growth=statistics.fmean(growth_abs) if growth_abs else 0.0,
        mean_rollover_growth_pct=statistics.fmean(growth_pct) if growth_pct else 0.0,
        max_jackpot=max(dated_jackpots, key=lambda p: p[1]) if dated_jackpots else None,
        mean_jackpot_when_won=statistics.fmean(jackpots_won) if jackpots_won else None,
        mean_jackpot_when_not_won=statistics.fmean(jackpots_lost) if jackpots_lost else None,
        jackpot_buckets=jackpot_buckets,
        weekday_buckets=weekday_buckets,
        month_buckets=month_buckets,
        weekdays_by_year=weekdays_by_year,
        largest_gaps=largest_gaps,
        homogeneity_tests=[
            _win_rate_homogeneity("win rate across jackpot bands", jackpot_buckets),
            _win_rate_homogeneity("win rate across weekdays", weekday_buckets),
            _win_rate_homogeneity("win rate across months", month_buckets),
        ],
        popularity_groups=popularity_groups,
        expected_birthday_numbers=expected_birthday,
    )


def _streak_runs(draws: list[DrawRecord]) -> list[list[DrawRecord]]:
    """The same runs `_build_streaks` describes, as the draws themselves —
    used for the within-streak growth figures."""
    runs: list[list[DrawRecord]] = []
    current: list[DrawRecord] = []
    for d in draws:
        current.append(d)
        if d.winners > 0:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return runs


def _money(v: float | None) -> str:
    return f"{v:,.0f}" if v is not None else "n/a"


def format_prize_report(a: PrizeAnalysis) -> str:
    """A plain-text rendering, matching `lotto_analysis.format_report`."""
    lines: list[str] = []
    lines.append(
        f"Draws analyzed: {a.draw_count} ({a.first_date.isoformat()} to {a.last_date.isoformat()})"
    )
    if a.missing_jackpot_draws:
        lines.append(
            f"  ({a.missing_jackpot_draws} draw(s) have no jackpot recorded - "
            "left out of the jackpot figures)"
        )
    lines.append("")

    lines.append("WINNERS")
    lines.append(
        f"  Draws won: {a.winner_draws} of {a.draw_count} ({a.win_rate:.1%}), "
        f"{a.total_winners} winning tickets in total"
    )
    for winners, count in a.winner_count_distribution:
        lines.append(f"    {winners} winner(s): {count} draws")
    lines.append("")

    lines.append("ROLLOVER STRUCTURE")
    lines.append(
        f"  Completed rollover streaks: {len([s for s in a.streaks if s.won])}, "
        f"mean {a.mean_streak_draws:.1f} draws, median {a.median_streak_draws:.0f} draws"
    )
    if a.longest_streak is not None:
        s = a.longest_streak
        lines.append(
            f"  Longest: {s.draws} draws, {s.start.isoformat()} to {s.end.isoformat()} "
            f"({_money(s.starting_jackpot)} -> {_money(s.ending_jackpot)})"
        )
    running = next((s for s in a.streaks if not s.won), None)
    if running is not None:
        lines.append(
            f"  Still running at the end of the data: {running.draws} draws since "
            f"{running.start.isoformat()}"
        )
    lines.append(
        f"  Rollover draws that grew the jackpot: {a.growing_rollover_draws}; "
        f"held flat at the base: {a.flat_rollover_draws}"
    )
    lines.append(
        f"  Mean growth on a growing draw: {_money(a.mean_rollover_growth)} "
        f"({a.mean_rollover_growth_pct:.1f}%)"
    )
    if a.max_jackpot is not None:
        lines.append(f"  Largest jackpot: {_money(a.max_jackpot[1])} on {a.max_jackpot[0].isoformat()}")
    lines.append(
        f"  Mean jackpot when won: {_money(a.mean_jackpot_when_won)} vs. "
        f"{_money(a.mean_jackpot_when_not_won)} when not won"
    )
    bases = sorted({round(j) for _, j in a.base_jackpots})
    lines.append(f"  Distinct opening (base) jackpots seen: {', '.join(_money(b) for b in bases)}")
    lines.append("")

    lines.append("WIN RATE BY JACKPOT SIZE")
    for b in a.jackpot_buckets:
        if b.draws == 0:
            continue
        lines.append(
            f"  {b.label:<12} {b.draws:>4} draws, won {b.winner_draws:>3} "
            f"({b.win_rate:>5.1%}), {b.total_winners} winning tickets"
        )
    lines.append("")

    lines.append("DATES")
    for b in a.weekday_buckets:
        lines.append(
            f"  {b.label:<10} {b.draws:>4} draws, won {b.winner_draws:>3} ({b.win_rate:>5.1%})"
        )
    lines.append("  Draw days by year:")
    for year, names in a.weekdays_by_year:
        lines.append(f"    {year}: {', '.join(n[:3] for n in names)}")
    lines.append("  Largest gaps between consecutive draws:")
    for prev, nxt, days in a.largest_gaps:
        lines.append(f"    {prev.isoformat()} -> {nxt.isoformat()}  {days} days")
    lines.append("")

    lines.append("WIN RATE BY MONTH")
    for b in a.month_buckets:
        lines.append(
            f"  {b.label:<10} {b.draws:>4} draws, won {b.winner_draws:>3} ({b.win_rate:>5.1%})"
        )
    lines.append("")

    lines.append("IS ANY OF THAT REAL? (chi-square, win rate held equal across buckets)")
    for t in a.homogeneity_tests:
        verdict = "REAL - unlikely to be chance" if t.significant else "noise - chance explains it"
        lines.append(
            f"  {t.label:<32} chi2={t.chi_square:>6.1f} df={t.degrees_of_freedom:<3} "
            f"p={t.p_value:.4f}  {verdict}"
        )
    lines.append("")

    lines.append("HOW CROWD-PLEASING THE WINNING COMBINATION WAS")
    lines.append(
        f"  A fair draw averages {a.expected_birthday_numbers:.2f} of its 6 numbers in "
        f"1-{BIRTHDAY_MAX} (the 'birthday' range)."
    )
    for g in a.popularity_groups:
        lines.append(
            f"  {g.label:<18} {g.draws:>4} draws, mean {g.mean_birthday_numbers:.2f} "
            f"birthday numbers (z = {g.z_score:+.1f}), mean jackpot {_money(g.mean_jackpot)}"
        )
    lines.append("")
    lines.append(f"  Every draw with 2+ winners ({len(a.multi_winner_draws)}):")
    for d in a.multi_winner_draws:
        nums = "-".join(f"{n:02d}" for n in sorted(d.numbers))
        lines.append(
            f"    {d.draw_date.isoformat()}  {nums}  "
            f"{_birthday_count(d)}/6 in 1-{BIRTHDAY_MAX}  {d.winners} winners"
        )
    return "\n".join(lines)
