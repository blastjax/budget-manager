"""Descriptive statistics over historic lotto draws.

Each draw is independent of the ones before it, so nothing here predicts a
future draw — but it answers the question people actually ask about a pile
of historic results: is any number running "hot", "cold", or "overdue", and
does the draw history even look uniformly random, or does something stand
out enough that it wouldn't be down to chance.

``analyze_draws`` is the one function that matters; everything else is a
plain-data result type or the formatter that turns it into a readable
report. It only needs each draw's 6 winning numbers, oldest first, so it
works the same whether they came from the database or from a parsed
"historic results" .txt file (see ``scripts/lotto_analysis_cli.py`` for the
latter).
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from itertools import combinations

NUMBER_MIN = 1
NUMBER_MAX = 58
NUMBERS_PER_DRAW = 6
POOL_SIZE = NUMBER_MAX - NUMBER_MIN + 1
# 1-29 is "low", 30-58 is "high" — an even split of the 58-number pool.
LOW_HIGH_SPLIT = (NUMBER_MIN + NUMBER_MAX) // 2


@dataclass
class NumberStat:
    number: int
    count: int
    # How many draws ago this number last hit: 0 means it was in the most
    # recent draw, 1 means the draw before that, and so on. None means it
    # has never been drawn at all.
    draws_since_seen: int | None


@dataclass
class PairStat:
    numbers: tuple[int, int]
    count: int


@dataclass
class LottoAnalysis:
    draw_count: int
    numbers: list[NumberStat]  # every 1..58, sorted by number
    hottest: list[NumberStat]  # most-drawn first
    coldest: list[NumberStat]  # least-drawn first (never-drawn numbers included)
    most_overdue: list[NumberStat]  # longest current gap first
    top_pairs: list[PairStat]  # most commonly drawn together
    expected_count_per_number: float
    # Chi-square goodness-of-fit against "every number is equally likely".
    # A large statistic (small p-value) means the counts are spread out more
    # than a fair, independent draw would typically produce — though with 58
    # numbers this happens by chance some of the time even when nothing is
    # actually wrong, which is exactly what the p-value quantifies.
    chi_square: float
    chi_square_p_value: float
    degrees_of_freedom: int
    sum_mean: float
    sum_stdev: float
    theoretical_sum_mean: float
    odd_count: int
    even_count: int
    low_count: int
    high_count: int
    # Draws containing at least one pair of consecutive numbers (e.g. 23, 24).
    consecutive_number_draws: int
    # How many numbers a draw shares with the one immediately before it,
    # averaged across all draws.
    repeat_from_previous_draw_avg: float
    theoretical_repeat_avg: float


def _chi_square_p_value(chi_square: float, df: int) -> float:
    """Upper-tail p-value for a chi-square statistic, via the Wilson-Hilferty
    cube-root normal approximation. Accurate to a few thousandths at the one
    degrees-of-freedom value this module actually uses (57 = 58 numbers - 1),
    which avoids pulling in scipy for a single function."""
    if df <= 0:
        return 1.0
    z = ((chi_square / df) ** (1 / 3) - (1 - 2 / (9 * df))) / math.sqrt(2 / (9 * df))
    return 0.5 * math.erfc(z / math.sqrt(2))


def analyze_draws(draws: list[list[int]], *, top_n: int = 10) -> LottoAnalysis:
    """Compute every statistic above over `draws`.

    `draws` must be oldest-first — that ordering is what makes "draws since
    last seen" and the previous-draw repeat count meaningful; every other
    statistic here is order-independent. Each entry is one draw's 6 winning
    numbers, in any order.
    """
    if not draws:
        raise ValueError("Need at least one draw to analyze.")

    counts = Counter(n for draw in draws for n in draw)
    last_seen_index: dict[int, int] = {}
    for i, draw in enumerate(draws):
        for n in draw:
            last_seen_index[n] = i
    latest_index = len(draws) - 1

    numbers = [
        NumberStat(
            number=n,
            count=counts.get(n, 0),
            draws_since_seen=(latest_index - last_seen_index[n]) if n in last_seen_index else None,
        )
        for n in range(NUMBER_MIN, NUMBER_MAX + 1)
    ]

    hottest = sorted(numbers, key=lambda s: (-s.count, s.number))[:top_n]
    coldest = sorted(numbers, key=lambda s: (s.count, s.number))[:top_n]
    overdue_candidates = [s for s in numbers if s.draws_since_seen is not None]
    most_overdue = sorted(overdue_candidates, key=lambda s: (-s.draws_since_seen, s.number))[
        :top_n
    ]

    pair_counts: Counter[tuple[int, int]] = Counter()
    for draw in draws:
        for a, b in combinations(sorted(draw), 2):
            pair_counts[(a, b)] += 1
    top_pairs = [
        PairStat(numbers=pair, count=c)
        for pair, c in sorted(pair_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top_n]
    ]

    draw_count = len(draws)
    expected_count_per_number = draw_count * NUMBERS_PER_DRAW / POOL_SIZE
    chi_square = sum(
        (s.count - expected_count_per_number) ** 2 / expected_count_per_number for s in numbers
    )
    degrees_of_freedom = POOL_SIZE - 1
    chi_square_p_value = _chi_square_p_value(chi_square, degrees_of_freedom)

    sums = [sum(draw) for draw in draws]
    sum_mean = sum(sums) / draw_count
    sum_variance = sum((s - sum_mean) ** 2 for s in sums) / draw_count
    sum_stdev = math.sqrt(sum_variance)
    theoretical_sum_mean = NUMBERS_PER_DRAW * (NUMBER_MIN + NUMBER_MAX) / 2

    total_numbers_drawn = draw_count * NUMBERS_PER_DRAW
    odd_count = sum(1 for draw in draws for n in draw if n % 2 == 1)
    even_count = total_numbers_drawn - odd_count
    low_count = sum(1 for draw in draws for n in draw if n <= LOW_HIGH_SPLIT)
    high_count = total_numbers_drawn - low_count

    consecutive_number_draws = sum(
        1
        for draw in draws
        if any(b - a == 1 for a, b in zip(sorted(draw), sorted(draw)[1:]))
    )

    repeat_counts = [len(set(draws[i]) & set(draws[i - 1])) for i in range(1, draw_count)]
    repeat_from_previous_draw_avg = (
        sum(repeat_counts) / len(repeat_counts) if repeat_counts else 0.0
    )
    # Expected overlap between two independent draws of 6 from the same pool
    # of 58: each of one draw's 6 numbers has a 6/58 chance of also landing
    # in the other draw, so the expectation is additive over the six.
    theoretical_repeat_avg = NUMBERS_PER_DRAW * NUMBERS_PER_DRAW / POOL_SIZE

    return LottoAnalysis(
        draw_count=draw_count,
        numbers=numbers,
        hottest=hottest,
        coldest=coldest,
        most_overdue=most_overdue,
        top_pairs=top_pairs,
        expected_count_per_number=expected_count_per_number,
        chi_square=chi_square,
        chi_square_p_value=chi_square_p_value,
        degrees_of_freedom=degrees_of_freedom,
        sum_mean=sum_mean,
        sum_stdev=sum_stdev,
        theoretical_sum_mean=theoretical_sum_mean,
        odd_count=odd_count,
        even_count=even_count,
        low_count=low_count,
        high_count=high_count,
        consecutive_number_draws=consecutive_number_draws,
        repeat_from_previous_draw_avg=repeat_from_previous_draw_avg,
        theoretical_repeat_avg=theoretical_repeat_avg,
    )


def format_report(a: LottoAnalysis) -> str:
    """A plain-text rendering of an analysis, for the CLI script (and handy
    for a quick look at the API response too)."""
    lines: list[str] = []
    lines.append(f"Draws analyzed: {a.draw_count}")
    lines.append(f"Expected hits per number if draws were uniform: {a.expected_count_per_number:.1f}")
    lines.append(
        f"Chi-square goodness-of-fit vs. uniform: {a.chi_square:.1f} "
        f"(df={a.degrees_of_freedom}, p={a.chi_square_p_value:.3f})"
    )
    verdict = (
        "no meaningful deviation from a fair, random draw"
        if a.chi_square_p_value > 0.05
        else "a deviation that would be unusual for a fair, random draw"
    )
    lines.append(f"  -> {verdict}")
    lines.append("")

    lines.append(f"Top {len(a.hottest)} hottest numbers:")
    for s in a.hottest:
        lines.append(f"  {s.number:>2}  {s.count} draws")
    lines.append("")

    lines.append(f"Top {len(a.coldest)} coldest numbers:")
    for s in a.coldest:
        lines.append(f"  {s.number:>2}  {s.count} draws")
    lines.append("")

    lines.append(f"Top {len(a.most_overdue)} most overdue numbers (draws since last hit):")
    for s in a.most_overdue:
        lines.append(f"  {s.number:>2}  {s.draws_since_seen} draws ago")
    lines.append("")

    lines.append(f"Top {len(a.top_pairs)} most common pairs:")
    for p in a.top_pairs:
        lines.append(f"  {p.numbers[0]:>2}-{p.numbers[1]:<2}  {p.count} draws")
    lines.append("")

    lines.append(
        f"Draw sum: mean {a.sum_mean:.1f} (theoretical {a.theoretical_sum_mean:.1f}), "
        f"stdev {a.sum_stdev:.1f}"
    )
    total = a.odd_count + a.even_count
    lines.append(
        f"Odd/even split: {a.odd_count} odd / {a.even_count} even ({a.odd_count / total:.1%} odd)"
    )
    lines.append(
        f"Low/high split (1-{LOW_HIGH_SPLIT} / {LOW_HIGH_SPLIT + 1}-{NUMBER_MAX}): "
        f"{a.low_count} low / {a.high_count} high ({a.low_count / total:.1%} low)"
    )
    lines.append(
        f"Draws with a consecutive pair (e.g. 23, 24): {a.consecutive_number_draws} of "
        f"{a.draw_count} ({a.consecutive_number_draws / a.draw_count:.1%})"
    )
    lines.append(
        "Average numbers repeated from the immediately preceding draw: "
        f"{a.repeat_from_previous_draw_avg:.2f} (theoretical {a.theoretical_repeat_avg:.2f})"
    )
    return "\n".join(lines)
