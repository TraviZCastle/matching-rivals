import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function renderedHtml() {
  return readFile(new URL("../.next/server/app/index.html", import.meta.url), "utf8");
}

test("server-renders the Matching Rivals lobby", async () => {
  const html = await renderedHtml();
  assert.match(html, /<title>Matching Rivals<\/title>/i);
  assert.match(html, /Find the right word/);
  assert.match(html, /Create a rival match/);
  assert.match(html, /Solo practice/);
  assert.match(html, /Six-digit room code/);
  for (const set of ["CET-4", "CET-6", "TEM-8", "IELTS", "TOEFL"]) {
    assert.match(html, new RegExp(set));
  }
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("ships race, practice, first-finisher, and half-second error interactions", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /ensureGameSession/);
  assert.match(source, /subscribeToGameRoom/);
  assert.match(source, /submitGameMatch/);
  assert.match(source, /createPracticeRoom/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /countdownAt/);
  assert.match(source, /finishedAt/);
  assert.match(source, /expiresAt/);
  assert.match(source, /millisecondsPart/);
  assert.match(source, /startRematch/);
  assert.match(source, /matching-rivals:theme/);
  assert.match(source, /randomNickname/);
  assert.match(source, /BrandIcon/);
  assert.match(source, /Boolean\(errorPair\)/);
  assert.match(source, /}, 500\);/);
  assert.match(source, /DNF/);
  assert.match(source, /The race ends as soon as one player completes every pair/);
  assert.doesNotMatch(source, /Waiting for .* to finish/);
  assert.doesNotMatch(source, /WORD MATCH RACE/);
});

test("includes five curated local question sets and a five-minute local room backend", async () => {
  const sets = await readFile(new URL("../lib/question-sets.ts", import.meta.url), "utf8");
  const localGame = await readFile(new URL("../lib/local-game.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/game-service.ts", import.meta.url), "utf8");

  for (const slug of ["cet4", "cet6", "tem8", "ielts", "toefl"]) {
    assert.match(sets, new RegExp(`slug: "${slug}"`));
  }
  assert.equal((sets.match(/questions: \[/g) ?? []).length, 5);
  assert.equal((sets.match(/{ id: "(?:cet4|cet6|tem8|ielts|toefl)-\d"/g) ?? []).length, 30);
  assert.match(localGame, /LOCAL_ROOM_LIFETIME_MS = 5 \* 60 \* 1000/);
  assert.match(localGame, /Date\.now\(\) >= Date\.parse\(record\.room\.expires_at\)/);
  assert.match(localGame, /record\.room\.status = "expired"/);
  assert.match(localGame, /if \(record\.room\.status === "expired"\) throw new Error\("room_expired"\)/);
  assert.match(localGame, /record\.room\.status = "finished"/);
  assert.match(localGame, /record\.room\.mode === "practice"/);
  assert.match(service, /NEXT_PUBLIC_GAME_BACKEND === "local"/);
});

test("includes the Supabase production foundation", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608200001_initial_schema.sql", import.meta.url),
    "utf8",
  );
  const adapter = await readFile(new URL("../lib/supabase-game.ts", import.meta.url), "utf8");
  const snapshotMigration = await readFile(
    new URL("../supabase/migrations/202608200003_room_snapshot.sql", import.meta.url),
    "utf8",
  );
  const nextMilestoneMigration = await readFile(
    new URL("../supabase/migrations/202608200004_practice_sets_and_expiry.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /enable row level security/i);
  assert.match(migration, /realtime\.broadcast_changes/i);
  assert.match(migration, /create or replace function public\.submit_match/i);
  assert.match(migration, /clock_timestamp\(\)/i);
  assert.match(adapter, /signInAnonymously/);
  assert.match(adapter, /server_now/);
  assert.match(adapter, /get_room_snapshot/);
  assert.match(adapter, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(adapter, /window\.sessionStorage/);
  assert.match(adapter, /private: true/);
  assert.match(adapter, /submitProductionMatch/);
  assert.match(snapshotMigration, /create or replace function public\.get_room_snapshot/i);
  assert.match(snapshotMigration, /clock_timestamp\(\)/i);
  assert.match(nextMilestoneMigration, /interval '5 minutes'/i);
  assert.match(nextMilestoneMigration, /status = 'expired'/i);
  assert.match(nextMilestoneMigration, /create or replace function public\.create_practice_room/i);
  assert.match(nextMilestoneMigration, /jsonb_build_object\('question_set_slug', snapshot_set_slug\)/i);
  assert.match(nextMilestoneMigration, /set status = 'finished', finished_at = current_player\.finished_at/i);
  for (const slug of ["cet4", "cet6", "tem8", "ielts", "toefl"]) {
    assert.match(nextMilestoneMigration, new RegExp(`'${slug}'`));
  }
});
