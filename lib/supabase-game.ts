import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ProductionRoom = {
  id: string;
  code: string;
  host_id: string;
  question_set_id: string;
  question_set_slug?: string;
  selected_pair_ids?: string[];
  mode: "race" | "practice";
  status: "waiting" | "countdown" | "playing" | "finished" | "expired";
  round: number;
  countdown_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
  created_at: string;
};

export type ProductionPlayer = {
  room_id: string;
  user_id: string;
  seat: 1 | 2;
  nickname: string;
  ready: boolean;
  progress: number;
  mistakes: number;
  matched_pair_ids: string[];
  finished_at: string | null;
  duration_ms: number | null;
  completion_id: string | null;
  joined_at: string;
};

export type ProductionQuestion = {
  id: string;
  question_set_id: string;
  ordinal: number;
  zh: string;
  en: string;
  part_of_speech: string;
};

export type ProductionRoomSnapshot = {
  room: ProductionRoom;
  players: ProductionPlayer[];
  questions: ProductionQuestion[];
  serverNow: string;
  clientClockSampledAt: number;
};

export type SoloLeaderboardRecord = {
  id: string;
  nickname: string;
  duration_ms: number;
  mistakes: number;
  completed_at: string;
};

export type FinalizedRound = {
  accepted: boolean;
  duration_ms: number;
  mistakes: number;
  finished_at: string;
  completion_id: string;
};

const globalForSupabase = globalThis as typeof globalThis & {
  matchingRivalsSupabaseClient?: SupabaseClient;
};

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      && (
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ),
  );
}

export function getSupabaseGameClient() {
  if (globalForSupabase.matchingRivalsSupabaseClient) {
    return globalForSupabase.matchingRivalsSupabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is incomplete.");
  }

  const browserClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storage: window.sessionStorage,
    },
  });
  globalForSupabase.matchingRivalsSupabaseClient = browserClient;
  return browserClient;
}

export async function ensureAnonymousSession(client = getSupabaseGameClient()) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Supabase did not return an anonymous user.");
  return data.user;
}

export async function createProductionRoom(nickname: string, questionSetSlug: string) {
  const client = getSupabaseGameClient();
  await ensureAnonymousSession(client);
  const { data, error } = await client.rpc("create_room", {
    p_nickname: nickname,
    p_question_set_slug: questionSetSlug,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function createProductionPracticeRoom(nickname: string, questionSetSlug: string) {
  const client = getSupabaseGameClient();
  await ensureAnonymousSession(client);
  const { data, error } = await client.rpc("create_practice_room", {
    p_nickname: nickname,
    p_question_set_slug: questionSetSlug,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function joinProductionRoom(code: string, nickname: string) {
  const client = getSupabaseGameClient();
  await ensureAnonymousSession(client);
  const { data, error } = await client.rpc("join_room", {
    p_code: code,
    p_nickname: nickname,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function setProductionReady(roomId: string, ready: boolean) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("set_player_ready", {
    p_room_id: roomId,
    p_ready: ready,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function openProductionRound(roomId: string) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("open_round_if_due", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function submitProductionMatch(
  roomId: string,
  chinesePairId: string,
  englishPairId: string,
) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("submit_match", {
    p_room_id: roomId,
    p_zh_pair_id: chinesePairId,
    p_en_pair_id: englishPairId,
  });
  if (error) throw error;
  return data as {
    correct: boolean;
    progress: number;
    mistakes: number;
    finished_at: string | null;
  };
}

export async function syncProductionMatchProgress(
  roomId: string,
  round: number,
  matchedPairIds: string[],
  mistakes: number,
) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("sync_match_progress", {
    p_room_id: roomId,
    p_round: round,
    p_matched_pair_ids: matchedPairIds,
    p_mistakes: mistakes,
  });
  if (error) throw error;
  return data as { accepted: boolean; progress: number; mistakes: number };
}

export async function finishProductionLocalRound(
  roomId: string,
  round: number,
  matchedPairIds: string[],
  mistakes: number,
  durationMs: number,
  completionId: string,
) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("finish_local_round", {
    p_room_id: roomId,
    p_round: round,
    p_matched_pair_ids: matchedPairIds,
    p_mistakes: mistakes,
    p_duration_ms: durationMs,
    p_completion_id: completionId,
  });
  if (error) throw error;
  return data as FinalizedRound;
}

export async function startProductionRematch(roomId: string) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("start_rematch", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function expireProductionRoom(roomId: string) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("expire_room_if_due", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function loadProductionSoloLeaderboard(questionSetSlug: string) {
  const client = getSupabaseGameClient();
  await ensureAnonymousSession(client);
  const { data, error } = await client.rpc("get_solo_leaderboard", {
    p_question_set_slug: questionSetSlug,
  });
  if (error) throw error;
  return (data ?? []) as SoloLeaderboardRecord[];
}

export async function loadProductionRoom(roomId: string): Promise<ProductionRoomSnapshot> {
  const client = getSupabaseGameClient();
  const requestStartedAt = Date.now();
  const { data, error } = await client.rpc("get_room_snapshot", {
    p_room_id: roomId,
  });
  const requestFinishedAt = Date.now();
  if (error) throw error;

  const snapshot = data as {
    room: ProductionRoom;
    players: ProductionPlayer[];
    questions: ProductionQuestion[];
    server_now: string;
  };

  return {
    room: snapshot.room,
    players: snapshot.players,
    questions: snapshot.questions,
    serverNow: snapshot.server_now,
    clientClockSampledAt: (requestStartedAt + requestFinishedAt) / 2,
  };
}

export async function subscribeToProductionRoom(
  roomId: string,
  onChange: () => void | Promise<void>,
) {
  const client = getSupabaseGameClient();
  await client.realtime.setAuth();
  const receiveChange = () => {
    void onChange();
  };
  const channel = client
    .channel(`room:${roomId}`, { config: { private: true } })
    .on("broadcast", { event: "INSERT" }, receiveChange)
    .on("broadcast", { event: "UPDATE" }, receiveChange)
    .on("broadcast", { event: "DELETE" }, receiveChange);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      void client.removeChannel(channel);
      reject(new Error("Realtime subscription timed out."));
    }, 10_000);

    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        void onChange();
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
        return;
      }

      if (!settled && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
        settled = true;
        window.clearTimeout(timeout);
        void client.removeChannel(channel);
        reject(error ?? new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });

  return () => {
    void client.removeChannel(channel);
  };
}
