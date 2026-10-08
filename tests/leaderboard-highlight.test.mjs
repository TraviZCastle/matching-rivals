import assert from "node:assert/strict";
import test from "node:test";
import { completedLeaderboardRun, currentRaceRecordId, currentSoloRecordId } from "../lib/leaderboard-highlight.ts";

function snapshot(mode = "practice") {
  return {
    room: { id: "test-room", round: 2, status: "finished", mode, question_set_id: "set-id", question_set_slug: "cet4" },
    players: [
      { seat: 1, nickname: "Calm Wolf", finished_at: "2026-10-08T03:04:05.123456+00:00", duration_ms: 9000, mistakes: 0 },
      ...(mode === "race" ? [{ seat: 2, nickname: "Swift Fox", finished_at: null, duration_ms: null, mistakes: 1 }] : []),
    ],
  };
}

test("highlights only the confirmed run, even when older times and nicknames are identical", () => {
  const run = completedLeaderboardRun(snapshot());
  const current = { ...run.result, id: "current" };
  const previous = { ...current, id: "older", completed_at: "2026-10-08T03:04:05.123455+00:00" };
  assert.equal(currentSoloRecordId([previous, current], run, "cet4"), "current");
  assert.equal(currentSoloRecordId([previous], run, "cet4"), undefined, "a run outside the top ten must not highlight an older row");
  assert.equal(currentSoloRecordId([current], run, "cet6"), undefined);
  assert.equal(currentSoloRecordId([current], null, "cet4"), undefined);
  assert.equal(currentRaceRecordId([], run, "cet4"), undefined);
});

test("waits for a saved result rather than highlighting an optimistic finish", () => {
  const pending = snapshot();
  pending.room.status = "playing";
  assert.equal(completedLeaderboardRun(pending), null);
  pending.room.status = "finished";
  pending.players[0].finished_at = null;
  assert.equal(completedLeaderboardRun(pending), null);
});

test("identifies rival results by both seats and the confirmed winner, including for the losing player", () => {
  const rival = snapshot("race");
  const timestamp = rival.players[0].finished_at;
  rival.players[0].finished_at = null;
  rival.players[0].duration_ms = null;
  rival.players[1].finished_at = timestamp;
  rival.players[1].duration_ms = 9500;
  // Snapshot order is not guaranteed to match seat order.
  rival.players.reverse();
  const run = completedLeaderboardRun(rival);
  const current = { ...run.result, id: "rival-current" };
  assert.equal(run.result.winner_seat, 2);
  assert.equal(run.result.player_one_nickname, "Calm Wolf");
  assert.equal(currentRaceRecordId([current], run, "cet4"), "rival-current");
  assert.equal(currentRaceRecordId([{ ...current, winner_seat: 1 }], run, "cet4"), undefined);
  assert.equal(currentRaceRecordId([{ ...current, player_two_nickname: "Other Rival" }], run, "cet4"), undefined);
  assert.equal(currentRaceRecordId([current], run, "ielts"), undefined);
  assert.equal(currentSoloRecordId([], run, "cet4"), undefined);
});

test("rematches have a new identity and local fallback snapshots resolve their bank", () => {
  const local = snapshot();
  delete local.room.question_set_slug;
  local.room.question_set_id = "cet4";
  const firstRun = completedLeaderboardRun(local);
  local.room.round += 1;
  const nextRun = completedLeaderboardRun(local);
  assert.notEqual(firstRun.key, nextRun.key);
  assert.equal(nextRun.questionSetSlug, "cet4");
});
