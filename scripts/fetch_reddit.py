#!/usr/bin/env python3
"""Pull r/glendale posts and comments about power, water, bills and the grid.

Reddit blocks unauthenticated API calls, so this reads the public PullPush
archive (https://pullpush.io) with Arctic Shift as a fallback. Usernames are
dropped; each quote keeps a link to its thread.

Writes data/community/reddit.json.
"""
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "community" / "reddit.json"
UA = "TheGlendaleGrid/0.1 (civic hackathon; github.com/Baleja/glendale-godseye)"
SUBS = ["glendale"]

TOPICS = {
    "bills": ["GWP bill", "electric bill", "power bill", "water bill", "utility bill"],
    "rates": ["rate increase", "GWP rates", "water rates"],
    "outages": ["power outage", "outage", "blackout"],
    "grid": ["Grayson", "solar", "undergrounding", "transformer", "power lines"],
}
MATCH = re.compile(
    r"\b(gwp|glendale water|electric|electricity|power bill|power|water bill|bill|rate|outage|"
    r"blackout|grayson|solar|kwh|transformer|grid|utility|utilities)\b",
    re.I,
)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("data") or []


def search(kind, sub, q, size=25):
    qs = urllib.parse.urlencode({"subreddit": sub, "q": q, "size": size, "sort": "desc", "sort_type": "score"})
    try:
        return get(f"https://api.pullpush.io/reddit/search/{kind}/?{qs}")
    except Exception as e:
        print(f"  pullpush {kind} '{q}' failed: {e}")
    field = "title" if kind == "submission" else "body"
    qs = urllib.parse.urlencode({"subreddit": sub, field: q, "limit": min(size, 100)})
    path = "posts" if kind == "submission" else "comments"
    try:
        return get(f"https://arctic-shift.photon-reddit.com/api/{path}/search?{qs}")
    except Exception as e:
        print(f"  arctic shift {kind} '{q}' failed: {e}")
        return []


def clean(text, limit=320):
    text = html.unescape(text or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_>#`~]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0] + "…"
    return text


def relevant(text):
    """At least two distinct utility words, so 'Solar Silver' paint or a lone 'bill' don't count."""
    return len({m.lower() for m in MATCH.findall(text)}) >= 2


def main():
    items = {}
    for topic, queries in TOPICS.items():
        for sub in SUBS:
            for q in queries:
                for kind in ("submission", "comment"):
                    rows = search(kind, sub, q)
                    print(f"{topic:8} {kind:10} '{q}': {len(rows)}")
                    for r in rows:
                        body = r.get("selftext") if kind == "submission" else r.get("body")
                        title = r.get("title") if kind == "submission" else None
                        if body in ("[removed]", "[deleted]"):
                            body = ""
                        text = clean(" — ".join(t for t in (title, body) if t))
                        if len(text) < 40 or not relevant(text):
                            continue
                        link = r.get("permalink") or ""
                        if not link and kind == "comment":
                            pid = (r.get("link_id") or "").removeprefix("t3_")
                            link = f"/r/{sub}/comments/{pid}/_/{r.get('id')}/" if pid else ""
                        if not link:
                            continue
                        key = r.get("id")
                        if key in items:
                            continue
                        items[key] = {
                            "topic": topic,
                            "kind": "post" if kind == "submission" else "comment",
                            "text": text,
                            "score": int(r.get("score") or 0),
                            "date": time.strftime("%Y-%m-%d", time.gmtime(int(r.get("created_utc") or 0))),
                            "url": "https://www.reddit.com" + link,
                        }
                    time.sleep(0.6)

    by_topic = {}
    for it in sorted(items.values(), key=lambda x: (-x["score"], x["date"]), reverse=False):
        by_topic.setdefault(it["topic"], []).append(it)
    keep = {t: sorted(v, key=lambda x: -x["score"])[:12] for t, v in by_topic.items()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "r/glendale via PullPush / Arctic Shift Reddit archives",
        "fetched": time.strftime("%Y-%m-%d"),
        "topics": keep,
    }, ensure_ascii=False, indent=1))
    print("wrote", OUT, {t: len(v) for t, v in keep.items()})


if __name__ == "__main__":
    main()
