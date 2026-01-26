from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.common import (
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
)


def _pick_llm_provider(config: dict[str, Any]) -> tuple[str, str] | None:
    keys = {
        "openai": os.getenv("OPENAI_API_KEY"),
        "deepseek": os.getenv("DEEPSEEK_API_KEY"),
    }
    for provider in config.get("llm", {}).get("provider_preference", ["deepseek", "openai"]):
        key = keys.get(provider)
        if key:
            return provider, key
    return None


def _default_base_url(provider: str) -> str:
    if provider == "deepseek":
        return "https://api.deepseek.com/v1"
    return "https://api.openai.com/v1"


def _extract_json_object(text: str) -> dict[str, Any] | None:
    text = (text or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def summarize_one(
    *,
    provider: str,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float,
    item: dict[str, Any],
) -> dict[str, Any]:
    prompt = (
        "Return ONLY a JSON object with this schema:\n"
        '{ "one_liner": string, "whats_new": string[] }\n'
        "Constraints:\n"
        "- one_liner: <= 200 chars, plain text.\n"
        "- whats_new: 2-5 bullet-like strings, each <= 120 chars, plain text.\n"
        "- No markdown, no extra keys.\n\n"
        f"Title: {item.get('title','')}\n"
        f"Authors: {', '.join(item.get('authors') or [])}\n"
        f"Abstract: {item.get('abstract','')}\n"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You summarize arXiv papers concisely and precisely."},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
    }

    url = base_url.rstrip("/") + "/chat/completions"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    data = _extract_json_object(content)
    if not data:
        raise ValueError("LLM returned non-JSON content")

    one_liner = str(data.get("one_liner", "")).strip()
    whats_new = data.get("whats_new") or []
    if not isinstance(whats_new, list):
        whats_new = []
    whats_new = [str(x).strip() for x in whats_new if str(x).strip()]

    if not one_liner:
        one_liner = first_sentence(item.get("abstract", ""))

    return {"one_liner": one_liner, "whats_new": whats_new, "provider": provider, "model": model}


def summarize_trend(
    *,
    provider: str,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    def clip(text: str, max_chars: int) -> str:
        text = " ".join((text or "").strip().split())
        if len(text) <= max_chars:
            return text
        return text[: max_chars - 1].rstrip() + "…"

    parts: list[str] = []
    for idx, item in enumerate(items, start=1):
        parts.append(f"{idx}) {clip(item.get('title',''), 180)}")
        parts.append(f"   Abstract: {clip(item.get('abstract',''), 700)}")

    prompt = (
        "Return ONLY a JSON object with this schema:\n"
        '{ "trend_summary": string, "themes": string[], "keywords": string[] }\n'
        "Constraints:\n"
        "- trend_summary: 2-4 sentences, plain text.\n"
        "- themes: 3-6 short phrases.\n"
        "- keywords: 6-12 keywords/phrases.\n"
        "- No markdown, no extra keys.\n\n"
        "Papers:\n"
        + "\n".join(parts)
        + "\n"
    )

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You infer daily research trends from paper titles and abstracts.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
    }

    url = base_url.rstrip("/") + "/chat/completions"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=90,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    data = _extract_json_object(content)
    if not data:
        raise ValueError("LLM returned non-JSON content")

    trend_summary = str(data.get("trend_summary", "")).strip()
    themes = data.get("themes") or []
    keywords = data.get("keywords") or []
    if not isinstance(themes, list):
        themes = []
    if not isinstance(keywords, list):
        keywords = []
    themes = [str(x).strip() for x in themes if str(x).strip()]
    keywords = [str(x).strip() for x in keywords if str(x).strip()]

    return {
        "trend_summary": trend_summary,
        "themes": themes,
        "keywords": keywords,
        "provider": provider,
        "model": model,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Optionally summarize new items with an LLM.")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = load_config(config_path)
    paths = resolve_paths(config, config_path)

    if not config.get("llm", {}).get("enabled", True):
        print("LLM summarization disabled in config (llm.enabled=false).")
        return 0

    picked = _pick_llm_provider(config)
    if not picked:
        print("No LLM API key found (set OPENAI_API_KEY or DEEPSEEK_API_KEY). Skipping summaries.")
        return 0
    provider, api_key = picked

    collected = read_json(paths.collected, default=None)
    if not collected:
        raise SystemExit(f"Missing collected items at {paths.collected}. Run scripts/collect.py first.")

    state = load_state(paths.state)
    new_items = stable_sort_items(compute_new_items(collected, state))
    lookback_days = coerce_int(config.get("issue", {}).get("lookback_days"), default=0)
    issue_items = stable_sort_items(filter_items_by_lookback(new_items, lookback_days))
    date_jst = today_jst_iso()

    if not issue_items:
        print("No new items to summarize.")
        return 0

    max_items = int(config.get("llm", {}).get("max_items", 10))
    to_summarize = issue_items[:max_items]

    existing = read_json(paths.summaries, default={"summaries": {}, "issues": {}})
    summaries: dict[str, Any] = existing.get("summaries") if isinstance(existing, dict) else {}
    if not isinstance(summaries, dict):
        summaries = {}
    issues: dict[str, Any] = existing.get("issues") if isinstance(existing, dict) else {}
    if not isinstance(issues, dict):
        issues = {}

    base_url = config.get("llm", {}).get("base_url", {}).get(provider) or _default_base_url(provider)
    model = config.get("llm", {}).get("model", {}).get(provider) or (
        "deepseek-chat" if provider == "deepseek" else "gpt-4o-mini"
    )
    temperature = float(config.get("llm", {}).get("temperature", 0))

    changed = False
    for item in to_summarize:
        item_id = item.get("id")
        if not item_id or item_id in summaries:
            continue
        try:
            summaries[item_id] = summarize_one(
                provider=provider,
                api_key=api_key,
                base_url=base_url,
                model=model,
                temperature=temperature,
                item=item,
            )
            changed = True
            print(f"Summarized {item_id}")
        except Exception as e:
            print(f"Failed to summarize {item_id}: {e}")

    trend_enabled = bool(config.get("llm", {}).get("trend_enabled", True))
    trend_max_items = coerce_int(config.get("llm", {}).get("trend_max_items"), default=25)
    need_trend = (
        trend_enabled
        and issue_items
        and (
            date_jst not in issues
            or not isinstance(issues.get(date_jst), dict)
            or "trend" not in issues[date_jst]
        )
    )
    if need_trend:
        try:
            issues[date_jst] = issues.get(date_jst) if isinstance(issues.get(date_jst), dict) else {}
            issues[date_jst]["trend"] = summarize_trend(
                provider=provider,
                api_key=api_key,
                base_url=base_url,
                model=model,
                temperature=temperature,
                items=issue_items[: max(1, trend_max_items)],
            )
            changed = True
            print(f"Summarized trend for {date_jst}")
        except Exception as e:
            print(f"Failed to summarize trend for {date_jst}: {e}")

    if not changed:
        print("No new summaries created.")
        return 0

    payload = {"summaries": summaries, "issues": issues}
    write_json_if_changed(paths.summaries, payload)
    print(f"Wrote summaries → {paths.summaries}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
