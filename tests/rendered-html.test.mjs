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
  assert.match(html, /Create a new match/);
  assert.match(html, /Six-digit room code/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("ships the complete local two-player interaction layer", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /BroadcastChannel/);
  assert.match(source, /localStorage/);
  assert.match(source, /countdownAt/);
  assert.match(source, /finishedAt/);
  assert.match(source, /startRematch/);
  assert.match(source, /matching-rivals:theme/);
  assert.match(source, /randomNickname/);
  assert.match(source, /BrandIcon/);
  assert.match(source, /Boolean\(errorPair\)/);
  assert.match(source, /}, 500\);/);
  assert.match(source, /灵感/);
  assert.match(source, /inspiration/);
  assert.doesNotMatch(source, /WORD MATCH RACE/);
});

test("includes the Supabase production foundation", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608200001_initial_schema.sql", import.meta.url),
    "utf8",
  );
  const adapter = await readFile(new URL("../lib/supabase-game.ts", import.meta.url), "utf8");

  assert.match(migration, /enable row level security/i);
  assert.match(migration, /realtime\.broadcast_changes/i);
  assert.match(migration, /create or replace function public\.submit_match/i);
  assert.match(migration, /clock_timestamp\(\)/i);
  assert.match(adapter, /signInAnonymously/);
  assert.match(adapter, /private: true/);
  assert.match(adapter, /submitProductionMatch/);
});
