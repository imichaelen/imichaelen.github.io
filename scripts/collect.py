from __future__ import annotations

import argparse
import sys
from datetime import timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import feedparser
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.common import iso_utc, load_config, parse_datetime, resolve_paths, stable_sort_items  # noqa: E402


ARXIV_API_URL = "https://export.arxiv.org/api/query"


def _clean_ws(value: str) -> str:
    return " ".join((value or "").strip().split())


def _extract_pdf_link(entry: Any) -> str | None:
    for link in entry.get("links", []) or []:
        if link.get("type") == "application/pdf" and link.get("href"):
            return str(link["href"])
    return None


def _normalize_entry(entry: Any) -> dict[str, Any]:
    entry_id_url = str(entry.get("id", "")).strip()
    arxiv_id = entry_id_url.split("/abs/")[-1] if "/abs/" in entry_id_url else entry_id_url
    arxiv_id = arxiv_id.strip()

    published_raw = entry.get("published") or entry.get("updated") or ""
    published_dt = parse_datetime(str(published_raw)) if published_raw else None
    published_at = (
        iso_utc(published_dt.astimezone(timezone.utc)) if published_dt else None
    )

    authors = [a.get("name", "").strip() for a in (entry.get("authors") or [])]
    authors = [a for a in authors if a]

    categories = [t.get("term", "").strip() for t in (entry.get("tags") or [])]
    categories = [c for c in categories if c]

    primary_category = None
    if entry.get("arxiv_primary_category") and entry["arxiv_primary_category"].get("term"):
        primary_category = str(entry["arxiv_primary_category"]["term"]).strip()

    url = str(entry.get("link") or entry_id_url).strip()
    if url.startswith("http://"):
        url = "https://" + url[len("http://") :]

    return {
        "id": f"arxiv:{arxiv_id}",
        "source": "arxiv",
        "title": _clean_ws(str(entry.get("title", ""))),
        "url": url,
        "published_at": published_at,
        "authors": authors,
        "abstract": _clean_ws(str(entry.get("summary", ""))),
        "raw": {
            "entry_id": entry_id_url,
            "pdf_url": _extract_pdf_link(entry),
            "categories": categories,
            "primary_category": primary_category,
        },
    }


def _requests_session(*, user_agent: str) -> requests.Session:
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def fetch_arxiv(
    *,
    search_query: str,
    max_results: int,
    sort_by: str,
    sort_order: str,
    user_agent: str,
) -> list[dict[str, Any]]:
    params = {
        "search_query": search_query,
        "start": 0,
        "max_results": int(max_results),
        "sortBy": sort_by,
        "sortOrder": sort_order,
    }
    url = f"{ARXIV_API_URL}?{urlencode(params)}"
    session = _requests_session(user_agent=user_agent)
    resp = session.get(url, timeout=30)
    resp.raise_for_status()

    feed = feedparser.parse(resp.content)
    items: list[dict[str, Any]] = []
    for entry in feed.entries:
        items.append(_normalize_entry(entry))
    return items


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect arXiv items into normalized JSON.")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = load_config(config_path)
    paths = resolve_paths(config, config_path)

    queries = config.get("arxiv", {}).get("queries") or []
    if not queries:
        raise SystemExit("No arXiv queries configured in config.yaml (arxiv.queries).")

    all_items: dict[str, dict[str, Any]] = {}
    for q in queries:
        search_query = q.get("search_query")
        if not search_query:
            continue
        query_name = str(q.get("name") or "").strip() or None
        items = fetch_arxiv(
            search_query=search_query,
            max_results=q.get("max_results", 50),
            sort_by=q.get("sort_by", "submittedDate"),
            sort_order=q.get("sort_order", "descending"),
            user_agent=config["arxiv"]["user_agent"],
        )
        for item in items:
            item_raw = item.setdefault("raw", {})
            if query_name:
                item_raw.setdefault("queries", [])
                if query_name not in item_raw["queries"]:
                    item_raw["queries"].append(query_name)

            existing = all_items.get(item["id"])
            if not existing:
                all_items[item["id"]] = item
                continue

            existing_raw = existing.setdefault("raw", {})
            existing_raw.setdefault("queries", [])
            for qn in item_raw.get("queries") or []:
                if qn not in existing_raw["queries"]:
                    existing_raw["queries"].append(qn)

    collected = stable_sort_items(all_items.values())
    paths.collected.parent.mkdir(parents=True, exist_ok=True)
    from scripts.common import write_json_if_changed

    write_json_if_changed(paths.collected, collected)
    print(f"Collected {len(collected)} items → {paths.collected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
