import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function renderedHtml() {
  return readFile(new URL("../.next/server/app/index.html", import.meta.url), "utf8");
}

async function questionBanks() {
  const source = await readFile(new URL("../lib/question-bank-data.generated.ts", import.meta.url), "utf8");
  return JSON.parse(source.slice(source.indexOf("{"), source.lastIndexOf(" as const;")));
}

test("server-renders the Matching Rivals lobby", async () => {
  const html = await renderedHtml();
  assert.match(html, /<title>Matching Rivals<\/title>/i);
  assert.match(html, /Find the right word/);
  assert.match(html, /New Match/);
  assert.match(html, /Solo Practice/);
  assert.match(html, /Room Code/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /CET-4/);
  assert.doesNotMatch(html, /<select|<option/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("ships race, practice, first-finisher, and half-second error interactions", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.match(source, /matching-rivals:nickname/);
  assert.match(source, /function cachedNickname/);
  assert.match(source, /window\.localStorage\.setItem\(LOCAL_NICKNAME/);
  assert.match(source, /BrandIcon/);
  assert.match(source, /Boolean\(errorPair\)/);
  assert.match(source, /}, 500\);/);
  assert.match(source, /DNF/);
  assert.match(source, /loadSoloLeaderboard/);
  assert.match(source, /SoloLeaderboard/);
  assert.match(source, /function RecordsDialog/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Shared across all Matching Rivals players/);
  assert.match(source, /Record Question Set/);
  assert.match(source, /function CompositeDropdown/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /rank-\$\{index \+ 1\}/);
  assert.match(source, /mode-detail-panel/);
  assert.match(source, /mode-support-panel/);
  assert.match(source, /designed to sharpen recall/);
  assert.doesNotMatch(source, /feature-row|how-it-works/);
  assert.doesNotMatch(source, /raceOrPractice|mode-support-set/);
  assert.doesNotMatch(source, /privacy-note|Local data · This browser only/);
  assert.doesNotMatch(source, /Local Preview/);
  assert.doesNotMatch(source, /ten fastest finishes for/);
  assert.doesNotMatch(source, /<select|<option/);
  assert.doesNotMatch(source, /Existing Room|Global Records|Top Solo Times|Global Top 10/);
  assert.doesNotMatch(source, /Create A Rival Match|Start Solo Practice/);
  assert.doesNotMatch(source, /five-minute room closes/);
  assert.doesNotMatch(source, /Waiting for .* to finish/);
  assert.doesNotMatch(source, /WORD MATCH RACE/);
  assert.match(styles, /\.mode-detail-panel::after[\s\S]*width: 42px/);
  assert.match(styles, /\.mode-detail-panel \{[\s\S]*padding-top: 34px/);
  assert.match(styles, /\.mode-support-copy[\s\S]*justify-content: flex-end/);
  assert.match(styles, /--font-product-sans: "Avenir Next"/);
  assert.match(styles, /--font-product-display: "Avenir Next"/);
  assert.match(styles, /\.primary-action \{[\s\S]*font-weight: 600/);
  assert.match(styles, /\.mode-toggle button \{[\s\S]*font-weight: 600/);

  const exitRoomSource = source.slice(source.indexOf("function exitRoom"), source.indexOf("function selectMode"));
  assert.doesNotMatch(exitRoomSource, /randomNickname|setName/);
});

test("includes five disjoint 500-pair banks and randomly selects six pairs per round", async () => {
  const sets = await readFile(new URL("../lib/question-sets.ts", import.meta.url), "utf8");
  const localGame = await readFile(new URL("../lib/local-game.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/game-service.ts", import.meta.url), "utf8");
  const banks = await questionBanks();

  assert.doesNotMatch(sets, /500-word/i);

  for (const slug of ["cet4", "cet6", "tem8", "ielts", "toefl"]) {
    assert.equal(banks[slug].length, 500);
    assert.match(sets, new RegExp(`slug: "${slug}"`));
  }
  const allPairs = Object.values(banks).flat();
  assert.equal(allPairs.length, 2_500);
  assert.equal(new Set(allPairs.map((pair) => pair.id)).size, 2_500);
  assert.equal(new Set(allPairs.map((pair) => pair.en.toLowerCase())).size, 2_500);
  assert.equal(new Set(allPairs.map((pair) => pair.zh)).size, 2_500);
  assert.ok(allPairs.every((pair) => ["noun", "verb", "adjective", "adverb", "phrase"].includes(pair.note)));
  assert.match(sets, /QUESTION_BANKS/);
  assert.match(localGame, /LOCAL_ROOM_LIFETIME_MS = 5 \* 60 \* 1000/);
  assert.match(localGame, /ROUND_PAIR_COUNT = 6/);
  assert.match(localGame, /randomQuestionIds/);
  assert.match(localGame, /selected_pair_ids/);
  assert.match(localGame, /Date\.now\(\) >= Date\.parse\(record\.room\.expires_at\)/);
  assert.match(localGame, /record\.room\.status = "expired"/);
  assert.match(localGame, /if \(record\.room\.status === "expired"\) throw new Error\("room_expired"\)/);
  assert.match(localGame, /record\.room\.status = "finished"/);
  assert.match(localGame, /record\.room\.mode === "practice"/);
  assert.match(localGame, /matching-rivals:solo-leaderboard:/);
  assert.match(localGame, /\.slice\(0, 10\)/);
  assert.match(service, /loadSoloLeaderboard/);
  assert.match(service, /hasSupabaseConfig\(\)[\s\S]*loadProductionSoloLeaderboard/);
  assert.match(service, /hasSharedSoloLeaderboard/);
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
  const bankMigration = await readFile(
    new URL("../supabase/migrations/202608200005_question_banks.sql", import.meta.url),
    "utf8",
  );
  const randomRoundMigration = await readFile(
    new URL("../supabase/migrations/202608200006_random_rounds_and_solo_leaderboard.sql", import.meta.url),
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
  assert.equal((bankMigration.match(/^ {2}\('[0-9a-f-]{36}',/gm) ?? []).length, 2_500);
  assert.match(randomRoundMigration, /selected_pair_ids uuid\[\]/i);
  assert.match(randomRoundMigration, /cardinality\(selected_pair_ids\) = 6/i);
  assert.match(randomRoundMigration, /order by random\(\)[\s\S]*limit 6/i);
  assert.match(randomRoundMigration, /create table public\.solo_records/i);
  assert.match(randomRoundMigration, /create or replace function public\.get_solo_leaderboard/i);
  assert.match(randomRoundMigration, /where set_row\.slug = p_question_set_slug/i);
  assert.match(randomRoundMigration, /delete from public\.solo_records as record_row/i);
  assert.match(randomRoundMigration, /limit 10/i);
  assert.match(randomRoundMigration, /set status = 'finished', finished_at = current_player\.finished_at/i);
});
