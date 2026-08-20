import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ProductionRoom = {
  id: string;
  code: string;
  host_id: string;
  question_set_id: string;
  status: "waiting" | "countdown" | "playing" | "finished";
  round: number;
  countdown_at: string | null;
  started_at: string | null;
  finished_at: string | null;
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
};

let browserClient: SupabaseClient | null = null;

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabaseGameClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is incomplete.");
  }

  browserClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
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

export async function createProductionRoom(nickname: string) {
  const client = getSupabaseGameClient();
  await ensureAnonymousSession(client);
  const { data, error } = await client.rpc("create_room", {
    p_nickname: nickname,
    p_question_set_slug: "starter",
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

export async function startProductionRematch(roomId: string) {
  const client = getSupabaseGameClient();
  const { data, error } = await client.rpc("start_rematch", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return data as ProductionRoom;
}

export async function loadProductionRoom(roomId: string): Promise<ProductionRoomSnapshot> {
  const client = getSupabaseGameClient();
  const roomResult = await client
    .from("rooms")
    .select("id, code, host_id, question_set_id, status, round, countdown_at, started_at, finished_at, created_at")
    .eq("id", roomId)
    .single();
  if (roomResult.error) throw roomResult.error;

  const [playersResult, questionsResult] = await Promise.all([
    client
      .from("room_players")
      .select("room_id, user_id, seat, nickname, ready, progress, mistakes, matched_pair_ids, finished_at, joined_at")
      .eq("room_id", roomId)
      .order("seat"),
    client
      .from("question_pairs")
      .select("id, question_set_id, ordinal, zh, en, part_of_speech")
      .eq("question_set_id", roomResult.data.question_set_id)
      .order("ordinal"),
  ]);
  if (playersResult.error) throw playersResult.error;
  if (questionsResult.error) throw questionsResult.error;

  return {
    room: roomResult.data as ProductionRoom,
    players: playersResult.data as ProductionPlayer[],
    questions: questionsResult.data as ProductionQuestion[],
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
    .on("broadcast", { event: "DELETE" }, receiveChange)
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
