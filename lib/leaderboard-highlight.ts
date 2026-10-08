import type { ProductionRoomSnapshot, RaceLeaderboardRecord, SoloLeaderboardRecord } from "./supabase-game";

export type CompletedLeaderboardRun = {
  key: string;
  questionSetSlug: string;
} & (
  | { mode: "solo"; result: Omit<SoloLeaderboardRecord, "id"> }
  | { mode: "rival"; result: Omit<RaceLeaderboardRecord, "id"> }
);

export function completedLeaderboardRun(snapshot: ProductionRoomSnapshot): CompletedLeaderboardRun | null {
  if (snapshot.room.status !== "finished") return null;
  const finisher = snapshot.players.find((player) => player.finished_at && player.duration_ms !== null);
  if (!finisher?.finished_at || finisher.duration_ms === null) return null;

  const run = {
    key: `${snapshot.room.id}:${snapshot.room.round}`,
    questionSetSlug: snapshot.room.question_set_slug ?? snapshot.room.question_set_id,
  };
  // Preserve the database timestamp, including microseconds. A displayed date,
  // nickname, or duration alone can also belong to an older leaderboard entry.
  const result = { completed_at: finisher.finished_at, duration_ms: finisher.duration_ms };
  if (snapshot.room.mode === "practice") {
    return { ...run, mode: "solo", result: { ...result, nickname: finisher.nickname, mistakes: finisher.mistakes } };
  }
  const first = snapshot.players.find((player) => player.seat === 1);
  const second = snapshot.players.find((player) => player.seat === 2);
  if (!first || !second) return null;
  return {
    ...run,
    mode: "rival",
    result: {
      ...result,
      player_one_nickname: first.nickname,
      player_two_nickname: second.nickname,
      winner_seat: finisher.seat,
    },
  };
}

export function currentSoloRecordId(records: SoloLeaderboardRecord[], run: CompletedLeaderboardRun | null, slug: string) {
  if (!run || run.mode !== "solo" || run.questionSetSlug !== slug) return undefined;
  return records.find((record) => (
    record.completed_at === run.result.completed_at
    && record.duration_ms === run.result.duration_ms
    && record.nickname === run.result.nickname
    && record.mistakes === run.result.mistakes
  ))?.id;
}

export function currentRaceRecordId(records: RaceLeaderboardRecord[], run: CompletedLeaderboardRun | null, slug: string) {
  if (!run || run.mode !== "rival" || run.questionSetSlug !== slug) return undefined;
  return records.find((record) => (
    record.completed_at === run.result.completed_at
    && record.duration_ms === run.result.duration_ms
    && record.player_one_nickname === run.result.player_one_nickname
    && record.player_two_nickname === run.result.player_two_nickname
    && record.winner_seat === run.result.winner_seat
  ))?.id;
}
