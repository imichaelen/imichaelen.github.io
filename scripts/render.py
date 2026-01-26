from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.common import (  # noqa: E402
    coerce_int,
    compute_new_items,
    filter_items_by_lookback,
    first_sentence,
    load_config,
    load_state,
    read_json,
    resolve_paths,
    stable_sort_items,
    today_jst_iso,
    write_json_if_changed,
    write_text_if_changed,
)


ISSUE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9+\\-]{2,}")

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "using",
    "use",
    "via",
    "towards",
    "toward",
    "over",
    "under",
    "within",
    "across",
    "between",
    "based",
    "approach",
    "method",
    "methods",
    "model",
    "models",
    "learning",
    "deep",
    "machine",
    "neural",
    "data",
    "analysis",
    "study",
    "paper",
    "results",
    "new",
}


def _md_escape(text: str) -> str:
    return (text or "").replace("\r", " ").strip()


def _top_categories(items: list[dict[str, Any]], limit: int = 5) -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    for item in items:
        raw = item.get("raw") or {}
        cat = raw.get("primary_category")
        if isinstance(cat, str) and cat.strip():
            counts[cat.strip()] += 1
    return counts.most_common(limit)


def _top_keywords(items: list[dict[str, Any]], limit: int = 10) -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    for item in items:
        title = (item.get("title") or "").strip()
        for word in WORD_RE.findall(title):
            w = word.lower()
            if w in STOPWORDS:
                continue
            counts[w] += 1
    return counts.most_common(limit)


def _render_item_blocks(
    *,
    items: list[dict[str, Any]],
    summaries: dict[str, Any],
    heading_level: int,
) -> list[str]:
    heading = "#" * max(1, heading_level)
    lines: list[str] = []
    for item in items:
        title = _md_escape(item.get("title", "Untitled"))
        url = _md_escape(item.get("url", ""))
        authors = item.get("authors") or []
        authors_str = ", ".join(_md_escape(a) for a in authors if a)
        published = _md_escape((item.get("published_at") or "")[:10])

        s = summaries.get(item.get("id") or "", {}) if isinstance(summaries, dict) else {}
        one_liner = _md_escape(str(s.get("one_liner") or "")) or first_sentence(
            item.get("abstract", "")
        )
        whats_new = s.get("whats_new") or []
        if not isinstance(whats_new, list):
            whats_new = []
        whats_new = [_md_escape(str(x)) for x in whats_new if _md_escape(str(x))]

        lines.append(f"{heading} [{title}]({url})" if url else f"{heading} {title}")
        if authors_str:
            lines.append(f"**Authors:** {authors_str}")
        if published:
            lines.append(f"**Published:** {published}")
        if one_liner:
            lines.append(f"**Summary:** {one_liner}")
        if whats_new:
            lines.append("")
            lines.append("**What's new**")
            for bullet in whats_new:
                lines.append(f"- {bullet}")
        lines.append("")
    return lines


def _group_items_by_query(
    items: list[dict[str, Any]], queries: list[dict[str, Any]]
) -> list[tuple[str, list[dict[str, Any]]]]:
    names: list[str] = []
    for q in queries:
        name = (q.get("name") or "").strip()
        if name:
            names.append(name)

    if not names:
        return [("All", items)]

    grouped: dict[str, list[dict[str, Any]]] = {n: [] for n in names}
    other: list[dict[str, Any]] = []

    for item in items:
        raw = item.get("raw") or {}
        item_queries = raw.get("queries") or []
        if not isinstance(item_queries, list):
            item_queries = []

        picked = None
        for n in names:
            if n in item_queries:
                picked = n
                break
        if picked:
            grouped[picked].append(item)
        else:
            other.append(item)

    out: list[tuple[str, list[dict[str, Any]]]] = []
    for n in names:
        if grouped[n]:
            out.append((n, stable_sort_items(grouped[n])))
    if other:
        out.append(("Other", stable_sort_items(other)))
    return out


def _render_issue_markdown(
    *,
    date_jst: str,
    queries: list[dict[str, Any]],
    items: list[dict[str, Any]],
    summaries: dict[str, Any],
    issue_trend: dict[str, Any] | None,
    lookback_days: int,
    skipped_count: int,
) -> str:
    lines: list[str] = []
    lines.extend(
        [
            "---",
            f'title: "Daily Issue (JST): {date_jst}"',
            "---",
            "",
            f"# Daily Issue (JST): {date_jst}",
            "",
            "## Trend",
            "",
        ]
    )

    if not items:
        if skipped_count and lookback_days:
            lines.append(
                f"_No new papers within the last {lookback_days} day(s) (skipped {skipped_count} older unseen items)._"
            )
        else:
            lines.append("_No new papers in this issue._")
        lines.append("")
    else:
        if issue_trend and (issue_trend.get("trend_summary") or issue_trend.get("themes")):
            summary_text = _md_escape(str(issue_trend.get("trend_summary") or "")).strip()
            if summary_text:
                lines.append(summary_text)
                lines.append("")
            themes = issue_trend.get("themes") or []
            if isinstance(themes, list) and themes:
                lines.append("**Themes**")
                for t in themes:
                    tt = _md_escape(str(t))
                    if tt:
                        lines.append(f"- {tt}")
                lines.append("")
            keywords = issue_trend.get("keywords") or []
            if isinstance(keywords, list) and keywords:
                lines.append("**Keywords**")
                for k in keywords:
                    kk = _md_escape(str(k))
                    if kk:
                        lines.append(f"- {kk}")
                lines.append("")
        else:
            cats = _top_categories(items)
            kws = _top_keywords(items)
            if cats:
                lines.append("**Top categories**")
                for c, n in cats:
                    lines.append(f"- {c} ({n})")
                lines.append("")
            if kws:
                lines.append("**Top keywords (titles)**")
                for w, n in kws:
                    lines.append(f"- {w} ({n})")
                lines.append("")

    lines.extend(["## arXiv: New Papers", ""])

    if queries:
        lines.append("**Query**")
        for q in queries:
            name = (q.get("name") or "").strip()
            sq = (q.get("search_query") or "").strip()
            if name and sq:
                lines.append(f"- {name} — `{sq}`")
            elif sq:
                lines.append(f"- `{sq}`")
        lines.append("")

    if not items:
        return "\n".join(lines).rstrip() + "\n"

    groups = _group_items_by_query(items, queries)
    if len(groups) == 1 and groups[0][0] == "All":
        lines.extend(_render_item_blocks(items=groups[0][1], summaries=summaries, heading_level=3))
        return "\n".join(lines).rstrip() + "\n"

    for group_name, group_items in groups:
        if group_name != "All":
            lines.append(f"### {group_name}")
            lines.append("")
        lines.extend(_render_item_blocks(items=group_items, summaries=summaries, heading_level=4))

    return "\n".join(lines).rstrip() + "\n"


def _render_item_sections(
    *,
    items: list[dict[str, Any]],
    summaries: dict[str, Any],
) -> str:
    if not items:
        return ""
    lines = _render_item_blocks(items=items, summaries=summaries, heading_level=3)
    return "\n".join(lines).rstrip() + "\n"


def _render_index_markdown(*, latest_date: str | None, archive_dates: list[str]) -> str:
    lines: list[str] = []
    lines.extend(
        [
            "---",
            'title: "Daily Newspaper"',
            "---",
            "",
            "# Daily Newspaper",
            "",
            "Automated daily arXiv digest generated by GitHub Actions.",
            "",
            "## Latest",
        ]
    )

    if latest_date:
        lines.append(f"- [{latest_date}](issues/{latest_date}.html)")
    else:
        lines.append("_No issues yet._")
    lines.append("")

    lines.append("## Archive")
    if not archive_dates:
        lines.append("_No issues yet._")
        lines.append("")
        return "\n".join(lines)

    for d in archive_dates:
        lines.append(f"- [{d}](issues/{d}.html)")
    lines.append("")
    return "\n".join(lines)


def _list_issue_dates(issues_dir: Path) -> list[str]:
    if not issues_dir.exists():
        return []
    dates: list[str] = []
    for p in issues_dir.iterdir():
        if p.is_file() and ISSUE_RE.match(p.name):
            dates.append(p.stem)
    return sorted(dates, reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render today's issue and update daily index.")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = load_config(config_path)
    paths = resolve_paths(config, config_path)

    collected = read_json(paths.collected, default=None)
    if not collected:
        raise SystemExit(f"Missing collected items at {paths.collected}. Run scripts/collect.py first.")

    state = load_state(paths.state)
    date_jst = today_jst_iso()

    summaries_payload = read_json(paths.summaries, default={"summaries": {}, "issues": {}})
    summaries = summaries_payload.get("summaries", {}) if isinstance(summaries_payload, dict) else {}
    if not isinstance(summaries, dict):
        summaries = {}
    issues = summaries_payload.get("issues", {}) if isinstance(summaries_payload, dict) else {}
    if not isinstance(issues, dict):
        issues = {}
    issue_trend = None
    if date_jst in issues and isinstance(issues.get(date_jst), dict):
        issue_trend = issues[date_jst].get("trend")
        if not isinstance(issue_trend, dict):
            issue_trend = None

    new_items = stable_sort_items(compute_new_items(collected, state))
    lookback_days = coerce_int(config.get("issue", {}).get("lookback_days"), default=0)
    issue_items = stable_sort_items(filter_items_by_lookback(new_items, lookback_days))
    skipped_count = max(0, len(new_items) - len(issue_items))

    issue_path = paths.issues_dir / f"{date_jst}.md"
    issue_changed = False
    if issue_path.exists():
        if issue_items:
            existing = issue_path.read_text(encoding="utf-8")
            existing = existing if existing.endswith("\n") else existing + "\n"
            appended = _render_item_sections(items=issue_items, summaries=summaries)
            if appended:
                issue_changed = write_text_if_changed(issue_path, existing + "\n" + appended)
    else:
        issue_md = _render_issue_markdown(
            date_jst=date_jst,
            queries=config.get("arxiv", {}).get("queries") or [],
            items=issue_items,
            summaries=summaries,
            issue_trend=issue_trend,
            lookback_days=lookback_days,
            skipped_count=skipped_count,
        )
        issue_changed = write_text_if_changed(issue_path, issue_md)

    archive_dates = _list_issue_dates(paths.issues_dir)
    latest_date = archive_dates[0] if archive_dates else None
    index_md = _render_index_markdown(latest_date=latest_date, archive_dates=archive_dates)
    index_changed = write_text_if_changed(paths.index, index_md)

    # Update state deterministically (only changes once per day unless new IDs appear).
    mark_skipped = bool(config.get("issue", {}).get("mark_skipped_as_seen", False))
    ids_to_mark = new_items if (lookback_days == 0 or mark_skipped) else issue_items
    new_ids = [i.get("id") for i in ids_to_mark if i.get("id")]
    seen_ids = set(state.get("seen_ids") or [])
    for nid in new_ids:
        seen_ids.add(nid)
    next_state = {
        "last_run_date_jst": date_jst,
        "seen_ids": sorted(seen_ids),
    }
    state_changed = write_json_if_changed(paths.state, next_state)

    print(
        f"Issue {date_jst}: {len(issue_items)} included / {len(new_items)} unseen "
        f"(issue_changed={issue_changed}, index_changed={index_changed}, state_changed={state_changed})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
