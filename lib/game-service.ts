import {
  createProductionPracticeRoom,
  createProductionRoom,
  ensureAnonymousSession,
  expireProductionRoom,
  hasSupabaseConfig,
  joinProductionRoom,
  loadProductionSoloLeaderboard,
  loadProductionRoom,
  openProductionRound,
  setProductionReady,
  startProductionRematch,
  submitProductionMatch,
  subscribeToProductionRoom,
  type ProductionRoomSnapshot,
  type SoloLeaderboardRecord,
} from "@/lib/supabase-game";
import {
  createLocalPracticeRoom,
  createLocalRaceRoom,
  ensureLocalSession,
  expireLocalRoom,
  joinLocalRoom,
  loadLocalSoloLeaderboard,
  loadLocalRoom,
  openLocalRound,
  setLocalReady,
  startLocalRematch,
  submitLocalMatch,
  subscribeToLocalRoom,
} from "@/lib/local-game";

export type GameRoomSnapshot = ProductionRoomSnapshot;
export type GameSoloRecord = SoloLeaderboardRecord;

export function isLocalTestBackend() {
  return process.env.NEXT_PUBLIC_GAME_BACKEND === "local";
}

export function hasGameConfig() {
  return isLocalTestBackend() || hasSupabaseConfig();
}

export function ensureGameSession() {
  return isLocalTestBackend() ? ensureLocalSession() : ensureAnonymousSession();
}

export function createRaceRoom(nickname: string, questionSetSlug: string) {
  return isLocalTestBackend()
    ? createLocalRaceRoom(nickname, questionSetSlug)
    : createProductionRoom(nickname, questionSetSlug);
}

export function createPracticeRoom(nickname: string, questionSetSlug: string) {
  return isLocalTestBackend()
    ? createLocalPracticeRoom(nickname, questionSetSlug)
    : createProductionPracticeRoom(nickname, questionSetSlug);
}

export function joinGameRoom(code: string, nickname: string) {
  return isLocalTestBackend() ? joinLocalRoom(code, nickname) : joinProductionRoom(code, nickname);
}

export function setGameReady(roomId: string, ready: boolean) {
  return isLocalTestBackend() ? setLocalReady(roomId, ready) : setProductionReady(roomId, ready);
}

export function openGameRound(roomId: string) {
  return isLocalTestBackend() ? openLocalRound(roomId) : openProductionRound(roomId);
}

export function submitGameMatch(roomId: string, chinesePairId: string, englishPairId: string) {
  return isLocalTestBackend()
    ? submitLocalMatch(roomId, chinesePairId, englishPairId)
    : submitProductionMatch(roomId, chinesePairId, englishPairId);
}

export function startGameRematch(roomId: string) {
  return isLocalTestBackend() ? startLocalRematch(roomId) : startProductionRematch(roomId);
}

export function expireGameRoom(roomId: string) {
  return isLocalTestBackend() ? expireLocalRoom(roomId) : expireProductionRoom(roomId);
}

export function loadGameRoom(roomId: string) {
  return isLocalTestBackend() ? loadLocalRoom(roomId) : loadProductionRoom(roomId);
}

export function loadSoloLeaderboard(questionSetSlug: string) {
  return isLocalTestBackend()
    ? loadLocalSoloLeaderboard(questionSetSlug)
    : loadProductionSoloLeaderboard(questionSetSlug);
}

export function subscribeToGameRoom(roomId: string, onChange: () => void | Promise<void>) {
  return isLocalTestBackend()
    ? subscribeToLocalRoom(roomId, onChange)
    : subscribeToProductionRoom(roomId, onChange);
}
