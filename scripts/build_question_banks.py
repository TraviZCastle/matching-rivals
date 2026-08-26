#!/usr/bin/env python3
"""Build five large, disjoint vocabulary banks from attributed open data.

The complete 25,000-pair bank is written to data and SQL files that are never
imported by the production client. A smaller generated bank is emitted as a
lazy-loaded local-development fallback.
"""

from __future__ import annotations

import csv
import hashlib
import http.client
import io
import itertools
import json
import math
import re
import tempfile
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_OUTPUT = ROOT / "data" / "question-banks.generated.json"
LOCAL_OUTPUT = ROOT / "lib" / "local-question-bank.generated.ts"
SQL_OUTPUT = ROOT / "supabase" / "migrations" / "202608260011_expand_question_banks_25000.sql"
ECDICT_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
TEM8_URL = "https://raw.githubusercontent.com/openetymology/OpenEtymology/main/TEM8/TEM8.txt"
SOURCE_CACHE = Path(tempfile.gettempdir()) / "matching-rivals-question-bank-sources"
NAMESPACE = uuid.UUID("8fc2cde5-2c81-49ad-b3e7-465907673fab")
SLUGS = ("cet4", "cet6", "tem8", "ielts", "toefl")
BUILD_ORDER = ("cet4", "cet6", "tem8", "ielts", "toefl")
TARGET_COUNTS = {
    "cet4": 4_000,
    "cet6": 4_500,
    "tem8": 5_500,
    "ielts": 5_000,
    "toefl": 6_000,
}
LOCAL_SAMPLE_COUNT = 500
QUESTION_SET_IDS = {
    "cet4": "12000000-0000-4000-8000-000000000001",
    "cet6": "12000000-0000-4000-8000-000000000002",
    "tem8": "12000000-0000-4000-8000-000000000003",
    "ielts": "12000000-0000-4000-8000-000000000004",
    "toefl": "12000000-0000-4000-8000-000000000005",
}
QUESTION_SET_TITLES = {
    "cet4": "CET-4",
    "cet6": "CET-6",
    "tem8": "TEM-8",
    "ielts": "IELTS",
    "toefl": "TOEFL",
}
PREVIOUS_QUESTION_SET_IDS = {
    "cet4": "11000000-0000-4000-8000-000000000001",
    "cet6": "11000000-0000-4000-8000-000000000002",
    "tem8": "11000000-0000-4000-8000-000000000003",
    "ielts": "11000000-0000-4000-8000-000000000004",
    "toefl": "11000000-0000-4000-8000-000000000005",
}
TARGET_FREQUENCY = {
    "cet4": 3_500,
    "cet6": 8_000,
    "tem8": 28_000,
    "ielts": 12_000,
    "toefl": 18_000,
}
GENERAL_MAX_FREQUENCY = 30_000
TARGET_LENGTH = {"cet4": 7, "cet6": 8, "tem8": 10, "ielts": 8, "toefl": 9}
SUPPLEMENT_TAGS = {
    "cet4": frozenset({"zk", "gk"}),
    "cet6": frozenset({"ky", "tem4", "bec"}),
    "tem8": frozenset({"gre", "gmat", "sat"}),
    "ielts": frozenset({"bec", "gmat", "sat"}),
    "toefl": frozenset({"gre", "gmat", "sat"}),
}
POS_LABELS = {
    "n": "noun",
    "v": "verb",
    "vt": "verb",
    "vi": "verb",
    "a": "adjective",
    "adj": "adjective",
    "j": "adjective",
    "r": "adverb",
    "adv": "adverb",
}
COMPACT_GLOSS_OVERRIDES = {
    "outlaw": ("罪犯", "歹徒"),
    "hatchback": ("掀背车",),
    "dowager": ("贵妇遗孀",),
    "xenophobia": ("仇外", "排外"),
    "backdate": ("回溯", "倒填"),
    "dumbfound": ("惊呆", "愕然"),
    "gibber": ("胡言", "乱语"),
    "idolise": ("崇拜",),
    "forbes": ("福布斯",),
    "disprove": ("反驳", "证伪"),
    "converter": ("转换器", "变流器"),
    "invalid": ("无效的", "作废的"),
    "blind": ("失明的", "盲目的"),
    "hire": ("雇用", "租用"),
    "mercury": ("水银", "汞"),
    "sponsor": ("赞助者", "发起人"),
    "excess": ("过量", "超额"),
    "motivate": ("激励", "促动"),
    "horrible": ("可怕的", "糟糕的"),
    "reckless": ("鲁莽的", "草率的"),
    "sluggish": ("迟缓的", "懒散的"),
    "unswerving": ("坚定的", "不动摇的"),
    "sanitary": ("卫生的",),
    "snowball": ("雪球",),
    "breadbasket": ("面包篮", "粮仓"),
    "boogie": ("布吉舞",),
    "bisexuality": ("双性恋倾向",),
}
PREFERRED_POS_OVERRIDES = {
    "blind": "adjective",
    "hire": "verb",
    "invalid": "adjective",
}
PROPER_NOUN_MARKERS = (
    "人名",
    "地名",
    "姓氏",
    "男子名",
    "女子名",
    "城市名",
    "国家名",
    "州名",
)
LOW_VALUE_ENTITY_MARKERS = ("集团", "有限公司", "球队")


@dataclass(frozen=True)
class Entry:
    word: str
    translation: str
    tags: frozenset[str]
    pos: str
    frequency: int
    collins: int


def fetch_text(url: str) -> io.StringIO:
    SOURCE_CACHE.mkdir(parents=True, exist_ok=True)
    suffix = Path(url).suffix or ".txt"
    cache_path = SOURCE_CACHE / f"{hashlib.sha256(url.encode()).hexdigest()[:16]}{suffix}"
    if cache_path.exists():
        return io.StringIO(cache_path.read_text(encoding="utf-8", errors="replace"), newline="")

    content = bytearray()
    expected_size: int | None = None
    for _attempt in range(8):
        headers = {"User-Agent": "matching-rivals-bank-builder/2.0"}
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
            cache_path.write_bytes(content)
            return io.StringIO(bytes(content).decode("utf-8", errors="replace"), newline="")
    raise RuntimeError(f"Could not download complete source after retries: {url}")


def positive_int(value: str | None) -> int | None:
    try:
        number = int(value or "0")
    except ValueError:
        return None
    return number if number > 0 else None


def dominant_pos(raw: str, translation: str, word: str) -> str:
    if word in PREFERRED_POS_OVERRIDES:
        return PREFERRED_POS_OVERRIDES[word]
    ranked = []
    for token in (raw or "").split("/"):
        match = re.fullmatch(r"([a-z]+):(\d+)", token.strip().lower())
        if match:
            ranked.append((int(match.group(2)), match.group(1)))
    code = max(ranked, default=(0, ""))[1]
    if code in POS_LABELS:
        return POS_LABELS[code]
    if code[:1] in POS_LABELS:
        return POS_LABELS[code[:1]]

    normalized = translation.replace("\\n", "\n").replace("\r", "\n")
    explicit = re.search(
        r"(?:^|[\n,，;；/])\s*(n|vt|vi|v|adj|adv|a|r)\.?(?:\s|$)",
        normalized,
        flags=re.IGNORECASE,
    )
    if explicit:
        return POS_LABELS.get(explicit.group(1).lower(), "noun")
    if word.endswith("ly"):
        return "adverb"
    if word.endswith(("ous", "ive", "able", "ible", "ful", "less", "ical", "ic", "ary")):
        return "adjective"
    if word.endswith(("ize", "ise", "ify")):
        return "verb"
    return "noun"


def clean_gloss_piece(piece: str) -> str | None:
    cleaned = re.sub(r"\([^)]*\)|\[[^]]*\]", "", piece)
    cleaned = re.sub(r"[A-Za-z0-9_=+<>]+", "", cleaned)
    cleaned = re.sub(r"^[\s.。:：·…-]+|[\s.。:：·…-]+$", "", cleaned)
    cleaned = re.sub(r"\s+", "", cleaned)
    if not re.fullmatch(r"[\u3400-\u9fff]+", cleaned):
        return None
    if not 1 <= len(cleaned) <= 14:
        return None
    return cleaned


def gloss_candidates(raw: str, preferred_pos: str | None = None) -> list[str]:
    parsed: list[tuple[str, str | None]] = []
    normalized = raw.replace("\\n", "\n").replace("\r", "\n")
    for line in normalized.split("\n"):
        line = line.strip()
        if not line:
            continue
        line_pos: str | None = None
        prefix = re.match(
            r"^(n|vt|vi|v|adj|adv|prep|pron|conj|num|art|aux|int|abbr|pl|a|r)\.?\s*",
            line,
            flags=re.IGNORECASE,
        )
        if prefix:
            line_pos = POS_LABELS.get(prefix.group(1).lower())
            line = line[prefix.end():]
        for piece in re.split(r"[,，;；、/]+", line):
            cleaned = clean_gloss_piece(piece)
            if cleaned and (cleaned, line_pos) not in parsed:
                parsed.append((cleaned, line_pos))

    if preferred_pos:
        ordered = [item for item in parsed if item[1] == preferred_pos]
        ordered += [item for item in parsed if item[1] is None]
        ordered += [item for item in parsed if item[1] not in {preferred_pos, None}]
    else:
        ordered = parsed

    meanings: list[str] = []
    for meaning, _pos in ordered:
        if meaning not in meanings:
            meanings.append(meaning)
    return meanings


def compact_gloss(meanings: list[str], used_glosses: set[str]) -> str | None:
    short_meanings = [meaning for meaning in meanings if len(meaning) <= 8][:8]
    if not short_meanings:
        return None
    primary = short_meanings[0]
    options: list[str] = []
    for count in range(min(3, len(short_meanings)), 0, -1):
        for selected in itertools.combinations(short_meanings, count):
            if primary not in selected:
                continue
            gloss = "，".join(selected)
            if len(gloss) <= 8 and gloss not in options:
                options.append(gloss)
    return next((gloss for gloss in options if gloss not in used_glosses), None)


def stable_jitter(slug: str, word: str) -> float:
    digest = hashlib.sha256(f"{slug}:{word}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32


def representative_score(slug: str, entry: Entry) -> float:
    frequency_distance = abs(
        math.log10(max(entry.frequency, 1)) - math.log10(TARGET_FREQUENCY[slug])
    )
    length_distance = abs(len(entry.word) - TARGET_LENGTH[slug])
    return (
        frequency_distance * 8
        + length_distance * 0.18
        - min(entry.collins, 5) * 0.12
        + stable_jitter(slug, entry.word)
    )


def exact_memberships(entry: Entry, tem8_words: set[str]) -> set[str]:
    memberships = {slug for slug in ("cet4", "cet6", "ielts", "toefl") if slug in entry.tags}
    if entry.word in tem8_words:
        memberships.add("tem8")
    return memberships


def candidate_rank(slug: str, entry: Entry, tem8_words: set[str]) -> tuple[int, float]:
    exact = exact_memberships(entry, tem8_words)
    if slug in exact:
        tier = 0
    elif entry.tags & SUPPLEMENT_TAGS[slug]:
        tier = 1
    elif entry.frequency <= GENERAL_MAX_FREQUENCY or entry.collins > 0:
        tier = 2
    else:
        tier = 3
    if slug not in exact and exact:
        tier += 2
    return tier, representative_score(slug, entry)


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
            raw_word = (row.get("word") or "").strip()
            word = raw_word.lower()
            translation = (row.get("translation") or "").strip()
            row_tags = frozenset((row.get("tag") or "").lower().split())
            row_collins = positive_int(row.get("collins")) or 0
            if (
                raw_word != word
                or not re.fullmatch(r"[a-z]{3,18}", word)
                or any(marker in translation for marker in PROPER_NOUN_MARKERS)
                or (
                    not row_tags
                    and row_collins == 0
                    and any(marker in translation for marker in LOW_VALUE_ENTITY_MARKERS)
                )
            ):
                continue
            pos = dominant_pos(row.get("pos") or "", translation, word)
            if not gloss_candidates(translation, pos):
                continue
            ranks = [
                value
                for value in (positive_int(row.get("bnc")), positive_int(row.get("frq")))
                if value
            ]
            entries.setdefault(
                word,
                Entry(
                    word=word,
                    translation=translation,
                    tags=row_tags,
                    pos=pos,
                    frequency=min(ranks, default=100_000),
                    collins=row_collins,
                ),
            )
    return entries


def is_inflected_variant(word: str, entries: dict[str, Entry]) -> bool:
    bases: set[str] = set()
    if len(word) > 5 and word.endswith("ing"):
        stem = word[:-3]
        bases.update((stem, stem + "e"))
        if len(stem) > 2 and stem[-1] == stem[-2]:
            bases.add(stem[:-1])
    if len(word) > 4 and word.endswith("ied"):
        bases.add(word[:-3] + "y")
    elif len(word) > 4 and word.endswith("ed"):
        stem = word[:-2]
        bases.update((stem, word[:-1]))
        if len(stem) > 2 and stem[-1] == stem[-2]:
            bases.add(stem[:-1])
    if len(word) > 5 and word.endswith("s") and not word.endswith(("ss", "us", "is", "ics", "ness")):
        return True
    return any(base in entries for base in bases)


def valid_gloss(gloss: str) -> bool:
    if not 1 <= len(gloss) <= 8:
        return False
    if any(separator in gloss for separator in (",", "、", "/", ";", "；")):
        return False
    parts = gloss.split("，")
    return (
        1 <= len(parts) <= 3
        and all(part and re.fullmatch(r"[\u3400-\u9fff]+", part) for part in parts)
    )


def build_banks(
    entries: dict[str, Entry],
    tem8_words: set[str],
) -> tuple[dict[str, list[dict[str, str]]], dict[str, int]]:
    used_words: set[str] = set()
    banks: dict[str, list[dict[str, str]]] = {}
    exact_counts: dict[str, int] = {}

    for slug in BUILD_ORDER:
        selected: list[dict[str, str]] = []
        used_card_glosses: set[str] = set()
        exact_count = 0

        def add_entry(entry: Entry) -> bool:
            nonlocal exact_count
            if entry.word in used_words:
                return False
            meanings = list(COMPACT_GLOSS_OVERRIDES.get(entry.word, ())) or gloss_candidates(
                entry.translation,
                entry.pos,
            )
            gloss = compact_gloss(meanings, used_card_glosses)
            if not gloss:
                return False
            selected.append(
                {
                    "id": str(uuid.uuid5(NAMESPACE, f"v2:{slug}:{entry.word}")),
                    "zh": gloss,
                    "en": entry.word,
                    "note": entry.pos,
                }
            )
            used_words.add(entry.word)
            used_card_glosses.add(gloss)
            if slug in exact_memberships(entry, tem8_words):
                exact_count += 1
            return True

        candidates = [
            entry
            for entry in entries.values()
            if entry.word not in used_words
            and not is_inflected_variant(entry.word, entries)
            and (
                exact_memberships(entry, tem8_words)
                or entry.tags & SUPPLEMENT_TAGS[slug]
                or entry.frequency <= GENERAL_MAX_FREQUENCY
                or entry.collins > 0
            )
        ]
        candidates.sort(key=lambda entry: candidate_rank(slug, entry, tem8_words))
        for entry in candidates:
            add_entry(entry)
            if len(selected) == TARGET_COUNTS[slug]:
                break
        if len(selected) != TARGET_COUNTS[slug]:
            raise RuntimeError(
                f"{slug} produced {len(selected)} pairs, expected {TARGET_COUNTS[slug]}"
            )
        banks[slug] = selected
        exact_counts[slug] = exact_count

    return {slug: banks[slug] for slug in SLUGS}, exact_counts


def render_data(banks: dict[str, list[dict[str, str]]]) -> str:
    return json.dumps(banks, ensure_ascii=False, indent=2) + "\n"


def render_local_typescript(banks: dict[str, list[dict[str, str]]]) -> str:
    local_banks = {slug: banks[slug][:LOCAL_SAMPLE_COUNT] for slug in SLUGS}
    data = json.dumps(local_banks, ensure_ascii=False, indent=2)
    return f"""// Generated by scripts/build_question_banks.py. Do not edit by hand.
// This representative fallback is lazy-loaded only by the local test backend.

import type {{ QuestionSeed, QuestionSetSlug }} from "@/lib/question-sets";

export const LOCAL_QUESTION_BANKS = {data} satisfies Record<QuestionSetSlug, QuestionSeed[]>;
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
    joined_rows = ",\n".join(rows)
    count_checks = "\n".join(
        f"  if (select count(*) from public.question_pairs where question_set_id = '{QUESTION_SET_IDS[slug]}'::uuid) <> {TARGET_COUNTS[slug]} then raise exception '{slug}_question_count_invalid'; end if;"
        for slug in SLUGS
    )
    set_ids = ", ".join(sql_text(QUESTION_SET_IDS[slug]) + "::uuid" for slug in SLUGS)
    question_sets = ",\n".join(
        f"  ('{QUESTION_SET_IDS[slug]}'::uuid, '{slug}', 2, '{QUESTION_SET_TITLES[slug]}', true)"
        for slug in SLUGS
    )
    record_moves = "\n".join(
        f"update public.{{table_name}} set question_set_id = '{QUESTION_SET_IDS[slug]}'::uuid where question_set_id = '{PREVIOUS_QUESTION_SET_IDS[slug]}'::uuid;"
        for slug in SLUGS
    )
    return f"""-- Generated by scripts/build_question_banks.py. Do not edit by hand.
-- Complete banks live in Postgres; each room snapshot still returns only six pairs.
-- Version 1 stays available for existing rooms; new rooms use the active version 2 banks.

begin;

update public.question_sets
set is_active = false
where slug in ('cet4', 'cet6', 'tem8', 'ielts', 'toefl');

insert into public.question_sets (id, slug, version, title, is_active)
values
{question_sets}
on conflict (slug, version) do update set
  title = excluded.title,
  is_active = excluded.is_active;

insert into public.question_pairs (id, question_set_id, ordinal, zh, en, part_of_speech)
values
{joined_rows}
on conflict (id) do update set
  question_set_id = excluded.question_set_id,
  ordinal = excluded.ordinal,
  zh = excluded.zh,
  en = excluded.en,
  part_of_speech = excluded.part_of_speech;

alter table public.question_pairs
drop constraint if exists question_pairs_compact_zh_check;

alter table public.question_pairs
add constraint question_pairs_compact_zh_check check (
  char_length(zh) between 1 and 8
  and zh = btrim(zh)
  and zh !~ '[,、/;；[:space:]]'
  and zh !~ '(^，|，$|，，)'
);

create unique index if not exists question_pairs_en_unique_idx
on public.question_pairs (question_set_id, lower(en));

create unique index if not exists question_pairs_set_zh_unique_idx
on public.question_pairs (question_set_id, zh);

{record_moves.replace('{table_name}', 'solo_records')}

{record_moves.replace('{table_name}', 'race_records')}

do $$
begin
{count_checks}
  if (select count(*) from public.question_pairs where question_set_id in ({set_ids})) <> 25000 then
    raise exception 'question_bank_total_invalid';
  end if;
end;
$$;

commit;
"""


def validate(banks: dict[str, list[dict[str, str]]]) -> None:
    pairs = [pair for slug in SLUGS for pair in banks[slug]]
    total = sum(TARGET_COUNTS.values())
    if len(pairs) != total:
        raise RuntimeError(f"Question bank total is not {total}")
    for slug in SLUGS:
        if len(banks[slug]) != TARGET_COUNTS[slug]:
            raise RuntimeError(f"{slug} count is invalid")
        if len({pair["zh"] for pair in banks[slug]}) != TARGET_COUNTS[slug]:
            raise RuntimeError(f"{slug} contains duplicate Chinese prompts")
    if len({pair["en"].casefold() for pair in pairs}) != total:
        raise RuntimeError("English words overlap within or between banks")
    if len({pair["id"] for pair in pairs}) != total:
        raise RuntimeError("Question IDs are not unique")
    if any(not valid_gloss(pair["zh"]) for pair in pairs):
        raise RuntimeError("A Chinese card violates the compact gloss format")
    if any(pair["note"] not in {"noun", "verb", "adjective", "adverb", "phrase"} for pair in pairs):
        raise RuntimeError("A question has an unsupported part of speech")


def main() -> None:
    tem8_words = load_tem8_words()
    entries = load_entries()
    banks, exact_counts = build_banks(entries, tem8_words)
    validate(banks)
    DATA_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUTPUT.write_text(render_data(banks), encoding="utf-8")
    LOCAL_OUTPUT.write_text(render_local_typescript(banks), encoding="utf-8")
    SQL_OUTPUT.write_text(render_sql(banks), encoding="utf-8")
    print(
        json.dumps(
            {
                "data_output": str(DATA_OUTPUT),
                "local_output": str(LOCAL_OUTPUT),
                "sql_output": str(SQL_OUTPUT),
                "banks": {slug: len(banks[slug]) for slug in SLUGS},
                "exact_source_membership": exact_counts,
                "total": sum(TARGET_COUNTS.values()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
