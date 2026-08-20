#!/usr/bin/env python3
"""Build five disjoint 500-pair question banks from attributed open data."""

from __future__ import annotations

import csv
import hashlib
import http.client
import io
import json
import math
import re
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "lib" / "question-bank-data.generated.ts"
SQL_OUTPUT = ROOT / "supabase" / "migrations" / "202608200005_question_banks.sql"
ECDICT_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
TEM8_URL = "https://raw.githubusercontent.com/openetymology/OpenEtymology/main/TEM8/TEM8.txt"
NAMESPACE = uuid.UUID("8fc2cde5-2c81-49ad-b3e7-465907673fab")
SLUGS = ("cet4", "cet6", "tem8", "ielts", "toefl")
QUESTION_SET_IDS = {
    "cet4": "11000000-0000-4000-8000-000000000001",
    "cet6": "11000000-0000-4000-8000-000000000002",
    "tem8": "11000000-0000-4000-8000-000000000003",
    "ielts": "11000000-0000-4000-8000-000000000004",
    "toefl": "11000000-0000-4000-8000-000000000005",
}
TARGET_FREQUENCY = {
    "cet4": 3_500,
    "cet6": 8_000,
    "tem8": 25_000,
    "ielts": 10_000,
    "toefl": 16_000,
}
TARGET_LENGTH = {"cet4": 7, "cet6": 8, "tem8": 9, "ielts": 8, "toefl": 9}
POS_LABELS = {"n": "noun", "v": "verb", "a": "adjective", "j": "adjective", "r": "adverb"}


@dataclass(frozen=True)
class Entry:
    word: str
    translation: str
    tags: frozenset[str]
    pos: str
    frequency: int
    collins: int


def fetch_text(url: str) -> io.StringIO:
    content = bytearray()
    expected_size: int | None = None
    for _attempt in range(8):
        headers = {"User-Agent": "matching-rivals-bank-builder/1.0"}
        if content:
            headers["Range"] = f"bytes={len(content)}-"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=180) as response:
            status = response.status
            content_range = response.headers.get("Content-Range")
            if status == 200 and content:
                content.clear()
            if content_range and "/" in content_range:
                expected_size = int(content_range.rsplit("/", 1)[1])
            elif not content and response.headers.get("Content-Length"):
                expected_size = int(response.headers["Content-Length"])
            try:
                chunk = response.read()
            except http.client.IncompleteRead as error:
                chunk = error.partial
            content.extend(chunk)
        if expected_size is None or len(content) >= expected_size:
            return io.StringIO(bytes(content).decode("utf-8", errors="replace"), newline="")
    raise RuntimeError(f"Could not download complete source after retries: {url}")


def positive_int(value: str | None) -> int | None:
    try:
        number = int(value or "0")
    except ValueError:
        return None
    return number if number > 0 else None


def dominant_pos(raw: str, translation: str, word: str) -> str:
    ranked = []
    for token in (raw or "").split("/"):
        match = re.fullmatch(r"([a-z]+):(\d+)", token.strip().lower())
        if match:
            ranked.append((int(match.group(2)), match.group(1)))
    code = max(ranked, default=(0, ""))[1]
    if code[:1] in POS_LABELS:
        return POS_LABELS[code[:1]]

    normalized = translation.replace("\\n", "\n").replace("\r", "\n")
    explicit = re.search(
        r"(?:^|[\n,，;；/])\s*(n|vt|vi|v|adj|adv|a|r)\.?(?:\s|$)",
        normalized,
        flags=re.IGNORECASE,
    )
    if explicit:
        label = explicit.group(1).lower()
        if label in {"vt", "vi"}:
            return "verb"
        if label == "adv":
            return "adverb"
        if label == "adj":
            return "adjective"
        return POS_LABELS.get(label[:1], "noun")

    if word.endswith("ly"):
        return "adverb"
    if word.endswith(("ous", "ive", "able", "ible", "ful", "less", "ical", "ic", "ary")):
        return "adjective"
    if word.endswith(("ize", "ise", "ify")):
        return "verb"
    return "noun"


def gloss_candidates(raw: str) -> list[str]:
    candidates: list[str] = []
    normalized = raw.replace("\\n", "\n").replace("\r", "\n")
    for piece in re.split(r"[\n,，;；、/]+", normalized):
        cleaned = re.sub(
            r"^(?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|aux|int|abbr|pl|a|r)\.?\s*",
            "",
            piece.strip(),
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\([^)]*\)|\[[^]]*\]", "", cleaned)
        cleaned = re.sub(r"[A-Za-z0-9_=+<>]+", "", cleaned)
        cleaned = re.sub(r"^[\s.。:：·…-]+|[\s.。:：·…-]+$", "", cleaned)
        cleaned = re.sub(r"\s+", "", cleaned)
        if not re.search(r"[\u3400-\u9fff]", cleaned):
            continue
        if not 2 <= len(cleaned) <= 14:
            continue
        if cleaned not in candidates:
            candidates.append(cleaned)
    return candidates


def stable_jitter(slug: str, word: str) -> float:
    digest = hashlib.sha256(f"{slug}:{word}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32


def representative_score(slug: str, entry: Entry) -> float:
    frequency_distance = abs(
        math.log10(max(entry.frequency, 1)) - math.log10(TARGET_FREQUENCY[slug])
    )
    length_distance = abs(len(entry.word) - TARGET_LENGTH[slug])
    return frequency_distance * 8 + length_distance * 0.18 - entry.collins * 0.08 + stable_jitter(slug, entry.word)


def load_tem8_words() -> set[str]:
    with fetch_text(TEM8_URL) as source:
        return {
            word
            for line in source
            if (word := line.strip().lower()) and re.fullmatch(r"[a-z]{3,18}", word)
        }


def load_entries() -> dict[str, Entry]:
    entries: dict[str, Entry] = {}
    with fetch_text(ECDICT_URL) as source:
        for row in csv.DictReader(source):
            word = (row.get("word") or "").strip().lower()
            translation = (row.get("translation") or "").strip()
            if not re.fullmatch(r"[a-z]{3,18}", word) or not gloss_candidates(translation):
                continue
            ranks = [value for value in (positive_int(row.get("bnc")), positive_int(row.get("frq"))) if value]
            entries.setdefault(
                word,
                Entry(
                    word=word,
                    translation=translation,
                    tags=frozenset((row.get("tag") or "").lower().split()),
                    pos=dominant_pos(row.get("pos") or "", translation, word),
                    frequency=min(ranks, default=100_000),
                    collins=positive_int(row.get("collins")) or 0,
                ),
            )
    return entries


def build_banks(entries: dict[str, Entry], tem8_words: set[str]) -> dict[str, list[dict[str, str]]]:
    used_words: set[str] = set()
    used_glosses: set[str] = set()
    banks: dict[str, list[dict[str, str]]] = {}

    for slug in SLUGS:
        candidates = [
            entry
            for entry in entries.values()
            if (slug in entry.tags if slug != "tem8" else entry.word in tem8_words)
            and entry.word not in used_words
        ]
        candidates.sort(key=lambda entry: representative_score(slug, entry))
        selected: list[dict[str, str]] = []
        for entry in candidates:
            gloss = next((value for value in gloss_candidates(entry.translation) if value not in used_glosses), None)
            if not gloss:
                continue
            selected.append(
                {
                    "id": str(uuid.uuid5(NAMESPACE, f"{slug}:{entry.word}")),
                    "zh": gloss,
                    "en": entry.word,
                    "note": entry.pos,
                }
            )
            used_words.add(entry.word)
            used_glosses.add(gloss)
            if len(selected) == 500:
                break
        if len(selected) != 500:
            raise RuntimeError(f"{slug} produced {len(selected)} pairs, expected 500")
        banks[slug] = selected
    return banks


def render_typescript(banks: dict[str, list[dict[str, str]]]) -> str:
    data = json.dumps(banks, ensure_ascii=False, indent=2)
    return """// Generated by scripts/build_question_banks.py. Do not edit by hand.
// Data sources and licenses are documented in THIRD_PARTY_NOTICES.md.

export const QUESTION_BANKS = """ + data + """ as const;
"""


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def render_sql(banks: dict[str, list[dict[str, str]]]) -> str:
    rows: list[str] = []
    for slug in SLUGS:
        set_id = QUESTION_SET_IDS[slug]
        for ordinal, pair in enumerate(banks[slug], start=1):
            rows.append(
                "  ("
                + ", ".join(
                    (
                        sql_text(pair["id"]),
                        sql_text(set_id),
                        str(ordinal),
                        sql_text(pair["zh"]),
                        sql_text(pair["en"]),
                        sql_text(pair["note"]),
                    )
                )
                + ")"
            )
    set_ids = ", ".join(sql_text(QUESTION_SET_IDS[slug]) for slug in SLUGS)
    return f"""-- Generated by scripts/build_question_banks.py. Do not edit by hand.
-- Data sources and licenses are documented in THIRD_PARTY_NOTICES.md.

begin;

delete from public.question_pairs
where question_set_id in ({set_ids});

insert into public.question_pairs (id, question_set_id, ordinal, zh, en, part_of_speech)
values
{',\n'.join(rows)};

commit;
"""


def validate(banks: dict[str, list[dict[str, str]]]) -> None:
    pairs = [pair for slug in SLUGS for pair in banks[slug]]
    if len(pairs) != 2_500:
        raise RuntimeError("Question bank total is not 2,500")
    if len({pair["en"].casefold() for pair in pairs}) != 2_500:
        raise RuntimeError("English words overlap between banks")
    if len({pair["zh"] for pair in pairs}) != 2_500:
        raise RuntimeError("Chinese prompts overlap between banks")
    if len({pair["id"] for pair in pairs}) != 2_500:
        raise RuntimeError("Question IDs are not unique")


def main() -> None:
    tem8_words = load_tem8_words()
    entries = load_entries()
    banks = build_banks(entries, tem8_words)
    validate(banks)
    OUTPUT.write_text(render_typescript(banks), encoding="utf-8")
    SQL_OUTPUT.write_text(render_sql(banks), encoding="utf-8")
    summary = {slug: len(banks[slug]) for slug in SLUGS}
    print(json.dumps({"output": str(OUTPUT), "sql_output": str(SQL_OUTPUT), "banks": summary, "total": 2_500}, ensure_ascii=False))


if __name__ == "__main__":
    main()
