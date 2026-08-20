import type {
  ProductionPlayer,
  ProductionQuestion,
  ProductionRoom,
  ProductionRoomSnapshot,
} from "@/lib/supabase-game";
import { getQuestionSet } from "@/lib/question-sets";

const ROOM_PREFIX = "matching-rivals:local-room:";
const PLAYER_KEY = "matching-rivals:local-player-id";
export const LOCAL_ROOM_LIFETIME_MS = 5 * 60 * 1000;

function localUserId() {
  const current = window.sessionStorage.getItem(PLAYER_KEY);
  if (current) return current;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(PLAYER_KEY, created);
  return created;
}

function roomKey(roomId: string) {
  return `${ROOM_PREFIX}${roomId}`;
}

function readRoom(roomId: string) {
  const value = window.localStorage.getItem(roomKey(roomId));
  return value ? JSON.parse(value) as { room: ProductionRoom; players: ProductionPlayer[] } : null;
}

function allRooms() {
  const rooms: Array<{ room: ProductionRoom; players: ProductionPlayer[] }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(ROOM_PREFIX)) continue;
    try {
      const value = window.localStorage.getItem(key);
      if (value) rooms.push(JSON.parse(value));
    } catch {
      // Ignore a malformed local test record.
    }
  }
  return rooms;
}

function publishRoom(roomId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(`matching-rivals:${roomId}`);
  channel.postMessage({ roomId });
  channel.close();
}

function saveRoom(record: { room: ProductionRoom; players: ProductionPlayer[] }) {
  window.localStorage.setItem(roomKey(record.room.id), JSON.stringify(record));
  publishRoom(record.room.id);
}

function ensureActive(record: { room: ProductionRoom; players: ProductionPlayer[] }) {
  if (
    record.room.status !== "finished"
    && record.room.status !== "expired"
    && Date.now() >= Date.parse(record.room.expires_at)
  ) {
    record.room.status = "expired";
    record.room.finished_at = new Date(record.room.expires_at).toISOString();
    saveRoom(record);
  }
  return record;
}

function mutateRoom<T>(roomId: string, mutation: (record: { room: ProductionRoom; players: ProductionPlayer[] }) => T) {
  const found = readRoom(roomId);
  if (!found) throw new Error("room_not_found");
  const record = ensureActive(found);
  const result = mutation(record);
  saveRoom(record);
  return result;
}

function questionsFor(room: ProductionRoom): ProductionQuestion[] {
  const set = getQuestionSet(room.question_set_id);
  if (!set) throw new Error("question_set_not_found");
  return set.questions.map((question, index) => ({
    id: question.id,
    question_set_id: set.slug,
    ordinal: index + 1,
    zh: question.zh,
    en: question.en,
    part_of_speech: question.note,
  }));
}

function createCode() {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!allRooms().some((record) => record.room.code === code)) {
      return code;
    }
  }
  throw new Error("room_code_exhausted");
}

function createLocalRoom(nickname: string, questionSetSlug: string, mode: "race" | "practice") {
  if (!getQuestionSet(questionSetSlug)) throw new Error("question_set_not_found");
  const userId = localUserId();
  const now = Date.now();
  const room: ProductionRoom = {
    id: crypto.randomUUID(),
    code: mode === "race" ? createCode() : "000000",
    host_id: userId,
    question_set_id: questionSetSlug,
    mode,
    status: mode === "practice" ? "playing" : "waiting",
    round: 1,
    countdown_at: null,
    started_at: mode === "practice" ? new Date(now).toISOString() : null,
    finished_at: null,
    expires_at: new Date(now + LOCAL_ROOM_LIFETIME_MS).toISOString(),
    created_at: new Date(now).toISOString(),
  };
  const player: ProductionPlayer = {
    room_id: room.id,
    user_id: userId,
    seat: 1,
    nickname: nickname.trim(),
    ready: mode === "practice",
    progress: 0,
    mistakes: 0,
    matched_pair_ids: [],
    finished_at: null,
    joined_at: new Date(now).toISOString(),
  };
  saveRoom({ room, players: [player] });
  return room;
}

export async function ensureLocalSession() {
  return { id: localUserId() };
}

export async function createLocalRaceRoom(nickname: string, questionSetSlug: string) {
  return createLocalRoom(nickname, questionSetSlug, "race");
}

export async function createLocalPracticeRoom(nickname: string, questionSetSlug: string) {
  return createLocalRoom(nickname, questionSetSlug, "practice");
}

export async function joinLocalRoom(code: string, nickname: string) {
  const found = allRooms().find((record) => record.room.code === code);
  if (!found) throw new Error("room_not_found");
  const record = ensureActive(found);
  if (record.room.status === "expired") throw new Error("room_expired");
  if (record.room.mode !== "race" || record.room.status !== "waiting") throw new Error("room_not_joinable");

  const userId = localUserId();
  const existing = record.players.find((player) => player.user_id === userId);
  if (existing) {
    existing.nickname = nickname.trim();
  } else {
    if (record.players.length >= 2) throw new Error("room_full");
    record.players.push({
      room_id: record.room.id,
      user_id: userId,
      seat: 2,
      nickname: nickname.trim(),
      ready: false,
      progress: 0,
      mistakes: 0,
      matched_pair_ids: [],
      finished_at: null,
      joined_at: new Date().toISOString(),
    });
  }
  saveRoom(record);
  return record.room;
}

export async function setLocalReady(roomId: string, ready: boolean) {
  return mutateRoom(roomId, (record) => {
    if (record.room.status === "expired") throw new Error("room_expired");
    if (record.room.status !== "waiting") throw new Error("room_not_waiting");
    const player = record.players.find((item) => item.user_id === localUserId());
    if (!player) throw new Error("room_not_found");
    player.ready = ready;
    if (record.players.length === 2 && record.players.every((item) => item.ready)) {
      record.room.status = "countdown";
      record.room.countdown_at = new Date(Date.now() + 3000).toISOString();
    }
    return record.room;
  });
}

export async function openLocalRound(roomId: string) {
  return mutateRoom(roomId, (record) => {
    if (record.room.status === "expired") throw new Error("room_expired");
    if (
      record.room.status === "countdown"
      && record.room.countdown_at
      && Date.now() >= Date.parse(record.room.countdown_at)
    ) {
      record.room.status = "playing";
      record.room.started_at = record.room.countdown_at;
    }
    return record.room;
  });
}

export async function submitLocalMatch(roomId: string, chinesePairId: string, englishPairId: string) {
  return mutateRoom(roomId, (record) => {
    if (record.room.status === "expired") throw new Error("room_expired");
    if (record.room.status !== "playing") throw new Error("room_not_playing");
    const questions = questionsFor(record.room);
    if (!questions.some((item) => item.id === chinesePairId) || !questions.some((item) => item.id === englishPairId)) {
      throw new Error("pair_not_in_question_set");
    }
    const player = record.players.find((item) => item.user_id === localUserId());
    if (!player || player.finished_at) throw new Error("player_already_finished");

    const correct = chinesePairId === englishPairId;
    if (!correct) {
      player.mistakes += 1;
    } else if (!player.matched_pair_ids.includes(chinesePairId)) {
      player.matched_pair_ids.push(chinesePairId);
      player.progress += 1;
      if (player.progress >= questions.length) {
        const finishedAt = new Date().toISOString();
        player.finished_at = finishedAt;
        record.room.status = "finished";
        record.room.finished_at = finishedAt;
      }
    }
    return {
      correct,
      progress: player.progress,
      mistakes: player.mistakes,
      finished_at: player.finished_at,
    };
  });
}

export async function startLocalRematch(roomId: string) {
  return mutateRoom(roomId, (record) => {
    if (record.room.status !== "finished") throw new Error("room_not_finished");
    const now = Date.now();
    for (const player of record.players) {
      player.ready = record.room.mode === "practice";
      player.progress = 0;
      player.mistakes = 0;
      player.matched_pair_ids = [];
      player.finished_at = null;
    }
    record.room.round += 1;
    record.room.status = record.room.mode === "practice" ? "playing" : "waiting";
    record.room.countdown_at = null;
    record.room.started_at = record.room.mode === "practice" ? new Date(now).toISOString() : null;
    record.room.finished_at = null;
    record.room.expires_at = new Date(now + LOCAL_ROOM_LIFETIME_MS).toISOString();
    return record.room;
  });
}

export async function expireLocalRoom(roomId: string) {
  const found = readRoom(roomId);
  if (!found) throw new Error("room_not_found");
  return ensureActive(found).room;
}

export async function loadLocalRoom(roomId: string): Promise<ProductionRoomSnapshot> {
  const found = readRoom(roomId);
  if (!found) throw new Error("room_not_found");
  const record = ensureActive(found);
  const now = Date.now();
  return {
    room: record.room,
    players: [...record.players].sort((left, right) => left.seat - right.seat),
    questions: questionsFor(record.room),
    serverNow: new Date(now).toISOString(),
    clientClockSampledAt: now,
  };
}

export async function subscribeToLocalRoom(roomId: string, onChange: () => void | Promise<void>) {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`matching-rivals:${roomId}`);
  if (channel) channel.onmessage = () => void onChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === roomKey(roomId)) void onChange();
  };
  window.addEventListener("storage", handleStorage);
  const expiryTimer = window.setInterval(() => void onChange(), 1000);
  queueMicrotask(() => void onChange());
  return () => {
    channel?.close();
    window.removeEventListener("storage", handleStorage);
    window.clearInterval(expiryTimer);
  };
}
