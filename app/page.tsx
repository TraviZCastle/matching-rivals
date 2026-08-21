"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createPracticeRoom,
  createRaceRoom,
  ensureGameSession,
  expireGameRoom,
  finishGameLocalRound,
  hasGameConfig,
  hasSharedSoloLeaderboard,
  isLocalTestBackend,
  joinGameRoom,
  loadGameRoom,
  loadSoloLeaderboard,
  openGameRound,
  setGameReady,
  startGameRematch,
  subscribeToGameRoom,
  syncGameMatchProgress,
  type GameSoloRecord,
  type GameRoomSnapshot,
} from "@/lib/game-service";
import { getQuestionSet, QUESTION_SETS, type QuestionSetSlug } from "@/lib/question-sets";

type RoomStatus = "waiting" | "countdown" | "playing" | "finished" | "expired";
type RoomMode = "race" | "practice";

type Player = {
  id: string;
  name: string;
  ready: boolean;
  progress: number;
  mistakes: number;
  matchedIds: string[];
  finishedAt?: number;
  durationMs?: number;
};

type Room = {
  id: string;
  code: string;
  status: RoomStatus;
  mode: RoomMode;
  hostId: string;
  questionSetId: string;
  createdAt: number;
  expiresAt: number;
  countdownAt?: number;
  startedAt?: number;
  round: number;
  players: Player[];
};

type Question = {
  id: string;
  zh: string;
  en: string;
  note: string;
};

type LocalRoundOverlay = {
  roomId: string;
  round: number;
  matchedIds: string[];
  mistakes: number;
  durationMs?: number;
  completionId?: string;
};

type RunClock = {
  key: string;
  startedAtEpoch: number;
  startedAtPerformance: number;
};

type DropdownOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

const QUESTIONS: Question[] = getQuestionSet("cet4")?.questions.slice(0, 6) ?? [];

const SESSION_ROOM = "matching-rivals:active-room";
const LOCAL_NICKNAME = "matching-rivals:nickname";
const RUN_CLOCK_PREFIX = "matching-rivals:run-clock:";

const NICKNAME_ADJECTIVES = ["Quiet", "Swift", "Cedar", "Silver", "Moss", "Dusk", "Night", "Calm"];
const NICKNAME_ANIMALS = ["Lynx", "Fox", "Heron", "Otter", "Owl", "Raven", "Koi", "Wolf"];

function randomNickname() {
  const adjective = NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)];
  const animal = NICKNAME_ANIMALS[Math.floor(Math.random() * NICKNAME_ANIMALS.length)];
  return `${adjective} ${animal}`;
}

function cachedNickname() {
  const current = window.localStorage.getItem(LOCAL_NICKNAME)?.trim();
  if (current && current.length <= 24) return current;
  const created = randomNickname();
  window.localStorage.setItem(LOCAL_NICKNAME, created);
  return created;
}

function titleCaseLabel(value: string) {
  return value.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

const QUESTION_SET_DROPDOWN_OPTIONS: DropdownOption<QuestionSetSlug>[] = QUESTION_SETS.map((set) => ({
  value: set.slug,
  label: set.label,
  description: titleCaseLabel(set.description),
}));

function seededShuffle<T>(items: T[], seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    const target = Math.floor(random * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function formatTime(milliseconds: number) {
  const safeValue = Math.max(0, milliseconds);
  const seconds = Math.floor(safeValue / 1000);
  const millisecondsPart = Math.floor(safeValue % 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes ? `${minutes}:` : ""}${minutes ? String(remainder).padStart(2, "0") : remainder}.${String(millisecondsPart).padStart(3, "0")}`;
}

function formatRoomLifetime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function playerTime(player: Player, room: Room, now: number) {
  if (player.durationMs !== undefined) return player.durationMs;
  if (!room.startedAt) return 0;
  return (player.finishedAt ?? now) - room.startedAt;
}

function toTimestamp(value: string | null) {
  return value ? Date.parse(value) : undefined;
}

function mapGameSnapshot(snapshot: GameRoomSnapshot) {
  const room: Room = {
    id: snapshot.room.id,
    code: snapshot.room.code,
    status: snapshot.room.status,
    mode: snapshot.room.mode,
    hostId: snapshot.room.host_id,
    questionSetId: snapshot.room.question_set_slug ?? snapshot.room.question_set_id,
    createdAt: Date.parse(snapshot.room.created_at),
    expiresAt: Date.parse(snapshot.room.expires_at),
    countdownAt: toTimestamp(snapshot.room.countdown_at),
    startedAt: toTimestamp(snapshot.room.started_at),
    round: snapshot.room.round,
    players: snapshot.players.map((player) => ({
      id: player.user_id,
      name: player.nickname,
      ready: player.ready,
      progress: player.progress,
      mistakes: player.mistakes,
      matchedIds: player.matched_pair_ids,
      finishedAt: toTimestamp(player.finished_at),
      durationMs: player.duration_ms ?? undefined,
    })),
  };
  const questions: Question[] = snapshot.questions.map((question) => ({
    id: question.id,
    zh: question.zh,
    en: question.en,
    note: question.part_of_speech,
  }));
  return { room, questions };
}

function friendlyGameError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("room_not_found")) return "Room not found. Check the code with your rival.";
  if (message.includes("room_full")) return "This room already has two players.";
  if (message.includes("room_not_joinable")) return "This match has already started.";
  if (message.includes("room_expired")) return "This room has expired. Create a new one to keep playing.";
  if (message.includes("question_set_not_found")) return "That question set is not available.";
  if (message.includes("invalid_nickname")) return "Use a nickname between 1 and 24 characters.";
  if (message.includes("Failed to fetch")) return "Could not reach the match server. Check your connection.";
  return "Something went wrong. Please try again.";
}

export default function Home() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<RoomMode>("race");
  const [questionSetSlug, setQuestionSetSlug] = useState<QuestionSetSlug>("cet4");
  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>(QUESTIONS);
  const [playerId, setPlayerId] = useState("");
  const [formError, setFormError] = useState("");
  const [selectedZh, setSelectedZh] = useState<string | null>(null);
  const [errorPair, setErrorPair] = useState<{ zh: string; en: string } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [runNow, setRunNow] = useState(0);
  const [runClock, setRunClock] = useState<RunClock | null>(null);
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [soloLeaderboard, setSoloLeaderboard] = useState<GameSoloRecord[]>([]);
  const [soloLeaderboardLoading, setSoloLeaderboardLoading] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsQuestionSetSlug, setRecordsQuestionSetSlug] = useState<QuestionSetSlug>("cet4");
  const [resultSyncing, setResultSyncing] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerIdRef = useRef("");
  const localRoundRef = useRef<LocalRoundOverlay | null>(null);
  const runClockRef = useRef<RunClock | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);

  const refreshRoom = useCallback(async (roomId: string) => {
    const snapshot = await loadGameRoom(roomId);
    const mapped = mapGameSnapshot(snapshot);
    const localRound = localRoundRef.current;
    const currentPlayerId = playerIdRef.current;
    if (localRound && localRound.roomId === mapped.room.id && localRound.round === mapped.room.round) {
      const currentPlayer = mapped.room.players.find((player) => player.id === currentPlayerId);
      if (currentPlayer) {
        if (localRound.matchedIds.length > currentPlayer.progress) {
          currentPlayer.progress = localRound.matchedIds.length;
          currentPlayer.matchedIds = [...localRound.matchedIds];
        }
        currentPlayer.mistakes = Math.max(currentPlayer.mistakes, localRound.mistakes);

        if (localRound.durationMs !== undefined && currentPlayer.durationMs === undefined && mapped.room.status !== "expired") {
          currentPlayer.durationMs = localRound.durationMs;
          currentPlayer.finishedAt = Date.now();
          mapped.room.status = "finished";
        } else if (currentPlayer.durationMs !== undefined) {
          localRoundRef.current = null;
        }
      }
    }
    const measuredAt = Date.now();
    setRoom(mapped.room);
    setQuestions(mapped.questions);
    setServerClockOffset(Date.parse(snapshot.serverNow) - snapshot.clientClockSampledAt);
    setClock(measuredAt);
    return mapped.room;
  }, []);

  const queueRoomRefresh = useCallback((roomId: string) => {
    refreshQueuedRef.current = true;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (refreshInFlightRef.current || !refreshQueuedRef.current) return;
      refreshInFlightRef.current = true;
      void (async () => {
        do {
          refreshQueuedRef.current = false;
          await refreshRoom(roomId);
          if (refreshQueuedRef.current) {
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
        } while (refreshQueuedRef.current);
      })()
        .catch((error) => {
          const message = friendlyGameError(error);
          setFormError(message);
          setLiveMessage(message);
        })
        .finally(() => {
          refreshInFlightRef.current = false;
        });
    }, 40);
  }, [refreshRoom]);

  useEffect(() => {
    queueMicrotask(() => setName(cachedNickname()));
    let cancelled = false;

    if (!hasGameConfig()) {
      queueMicrotask(() => {
        setFormError("The live match server is not configured.");
        setBooting(false);
      });
      return;
    }

    void (async () => {
      try {
        const user = await ensureGameSession();
        if (cancelled) return;
        playerIdRef.current = user.id;
        setPlayerId(user.id);

        const savedRoomId = window.sessionStorage.getItem(SESSION_ROOM);
        if (savedRoomId) {
          try {
            await refreshRoom(savedRoomId);
          } catch {
            window.sessionStorage.removeItem(SESSION_ROOM);
          }
        }
      } catch (error) {
        if (!cancelled) setFormError(friendlyGameError(error));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refreshRoom]);

  useEffect(() => {
    if (!recordsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordsOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [recordsOpen]);

  useEffect(() => {
    if (!room?.id || !playerId) return;
    const roomId = room.id;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void subscribeToGameRoom(roomId, () => queueRoomRefresh(roomId))
      .then((stop) => {
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch((error) => {
        if (!cancelled) setFormError(friendlyGameError(error));
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [room?.id, playerId, queueRoomRefresh]);

  useEffect(() => {
    if (!room || room.status === "finished" || room.status === "expired") {
      return;
    }
    const timer = window.setInterval(() => {
      setClock(Date.now());
      setRunNow(performance.now());
    }, 50);
    return () => window.clearInterval(timer);
  }, [room]);

  useEffect(() => {
    if (room?.status !== "countdown" || !room.countdownAt) return;
    const target = room.countdownAt;
    const timer = window.setTimeout(() => {
      void openGameRound(room.id)
        .then(() => refreshRoom(room.id))
        .catch((error) => setFormError(friendlyGameError(error)));
    }, Math.max(0, target - (Date.now() + serverClockOffset)));
    return () => window.clearTimeout(timer);
  }, [room?.status, room?.countdownAt, room?.id, refreshRoom, serverClockOffset]);

  const expiringRoomId = room?.id;
  const expiringRoomStatus = room?.status;
  const expiringRoomAt = room?.expiresAt;
  useEffect(() => {
    if (!expiringRoomId || !expiringRoomAt || expiringRoomStatus === "finished" || expiringRoomStatus === "expired") return;
    const timer = window.setTimeout(() => {
      void expireGameRoom(expiringRoomId)
        .then(() => refreshRoom(expiringRoomId))
        .catch((error) => setFormError(friendlyGameError(error)));
    }, Math.max(0, expiringRoomAt - (Date.now() + serverClockOffset)));
    return () => window.clearTimeout(timer);
  }, [expiringRoomId, expiringRoomStatus, expiringRoomAt, refreshRoom, serverClockOffset]);

  const me = room?.players.find((player) => player.id === playerId);
  const opponent = room?.players.find((player) => player.id !== playerId);
  const isHost = room?.hostId === playerId;
  const serverClock = clock + serverClockOffset;
  const selectedQuestionSet = getQuestionSet(questionSetSlug) ?? QUESTION_SETS[0];
  const roomQuestionSet = getQuestionSet(room?.questionSetId ?? questionSetSlug) ?? selectedQuestionSet;
  const recordsQuestionSet = getQuestionSet(recordsQuestionSetSlug) ?? QUESTION_SETS[0];

  useEffect(() => {
    if (!room || room.status !== "playing" || !me || !playerId || questions.length !== 6) return;
    const key = `${room.id}:${room.round}:${playerId}`;
    if (runClockRef.current?.key === key) return;

    const nowEpoch = Date.now();
    const nowPerformance = performance.now();
    let startedAtEpoch = nowEpoch;

    if (room.mode === "race" && room.startedAt) {
      const elapsed = Math.max(0, nowEpoch + serverClockOffset - room.startedAt);
      startedAtEpoch = nowEpoch - elapsed;
    } else {
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(`${RUN_CLOCK_PREFIX}${key}`) ?? "null") as { startedAtEpoch?: number } | null;
        if (stored?.startedAtEpoch && stored.startedAtEpoch <= nowEpoch) {
          startedAtEpoch = stored.startedAtEpoch;
        }
      } catch {
        // Start a fresh local monotonic clock if a saved value is malformed.
      }
      window.sessionStorage.setItem(`${RUN_CLOCK_PREFIX}${key}`, JSON.stringify({ startedAtEpoch }));
    }

    const nextClock: RunClock = {
      key,
      startedAtEpoch,
      startedAtPerformance: nowPerformance - Math.max(0, nowEpoch - startedAtEpoch),
    };
    runClockRef.current = nextClock;
    setRunClock(nextClock);
    setRunNow(nowPerformance);

    const currentLocalRound = localRoundRef.current;
    if (!currentLocalRound || currentLocalRound.roomId !== room.id || currentLocalRound.round !== room.round) {
      localRoundRef.current = {
        roomId: room.id,
        round: room.round,
        matchedIds: [...me.matchedIds],
        mistakes: me.mistakes,
      };
    }
  }, [me, playerId, questions.length, room, serverClockOffset]);

  const currentRunKey = room && playerId ? `${room.id}:${room.round}:${playerId}` : "";
  const localPlayerTime = me?.durationMs !== undefined
    ? me.durationMs
    : runClock?.key === currentRunKey
      ? Math.max(0, runNow - runClock.startedAtPerformance)
      : room && me
        ? playerTime(me, room, serverClock)
        : 0;

  useEffect(() => {
    if (!recordsOpen) return;
    let cancelled = false;
    void loadSoloLeaderboard(recordsQuestionSetSlug)
      .then((records) => {
        if (!cancelled) setSoloLeaderboard(records);
      })
      .catch(() => {
        if (!cancelled) setSoloLeaderboard([]);
      })
      .finally(() => {
        if (!cancelled) setSoloLeaderboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordsOpen, recordsQuestionSetSlug, room?.status, room?.round]);

  const chineseOrder = useMemo(
    () => seededShuffle(questions, `${room?.code}-${room?.round}-${playerId}-zh`),
    [questions, room?.code, room?.round, playerId],
  );
  const englishOrder = useMemo(
    () => seededShuffle(questions, `${room?.code}-${room?.round}-${playerId}-en`),
    [questions, room?.code, room?.round, playerId],
  );

  async function rememberGameRoom(roomId: string) {
    window.sessionStorage.setItem(SESSION_ROOM, roomId);
    localRoundRef.current = null;
    runClockRef.current = null;
    setRunClock(null);
    setResultSyncing(false);
    await refreshRoom(roomId);
  }

  function validateName() {
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError("Enter a nickname before continuing.");
      return null;
    }
    window.localStorage.setItem(LOCAL_NICKNAME, cleanName);
    if (cleanName !== name) setName(cleanName);
    return cleanName;
  }

  function updateNickname(nextName: string) {
    setName(nextName);
    const cleanName = nextName.trim();
    if (cleanName && cleanName.length <= 24) {
      window.localStorage.setItem(LOCAL_NICKNAME, cleanName);
    }
  }

  async function createRoom() {
    const cleanName = validateName();
    if (!cleanName) return;
    setBusy(true);
    try {
      const createdRoom = await createRaceRoom(cleanName, questionSetSlug);
      setFormError("");
      await rememberGameRoom(createdRoom.id);
    } catch (error) {
      const message = friendlyGameError(error);
      setFormError(message);
      setLiveMessage(message);
    } finally {
      setBusy(false);
    }
  }

  async function startPractice() {
    const cleanName = validateName();
    if (!cleanName) return;
    setBusy(true);
    try {
      const practiceRoom = await createPracticeRoom(cleanName, questionSetSlug);
      setFormError("");
      await rememberGameRoom(practiceRoom.id);
    } catch (error) {
      const message = friendlyGameError(error);
      setFormError(message);
      setLiveMessage(message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent) {
    event.preventDefault();
    const cleanName = validateName();
    if (!cleanName) return;
    if (code.length !== 6) {
      setFormError("Enter the complete six-digit room code.");
      return;
    }
    setBusy(true);
    try {
      const joinedRoom = await joinGameRoom(code, cleanName);
      setFormError("");
      await rememberGameRoom(joinedRoom.id);
    } catch (error) {
      const message = friendlyGameError(error);
      setFormError(message);
      setLiveMessage(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReady() {
    if (!room || !me || room.status !== "waiting") return;
    setBusy(true);
    try {
      await setGameReady(room.id, !me.ready);
      await refreshRoom(room.id);
    } catch (error) {
      setFormError(friendlyGameError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function chooseChinese(questionId: string) {
    if (!room || room.status !== "playing" || me?.finishedAt || errorPair) return;
    if (me?.matchedIds.includes(questionId)) return;
    setSelectedZh((current) => (current === questionId ? null : questionId));
    setErrorPair(null);
    setLiveMessage("Chinese word selected. Choose its English match.");
  }

  function chooseEnglish(questionId: string, eventTime: number) {
    if (!room || room.status !== "playing" || !me || me.finishedAt || errorPair) return;
    if (!selectedZh || me?.matchedIds.includes(questionId)) return;
    const chinesePairId = selectedZh;
    const currentRound = localRoundRef.current && localRoundRef.current.roomId === room.id && localRoundRef.current.round === room.round
      ? localRoundRef.current
      : { roomId: room.id, round: room.round, matchedIds: [...me.matchedIds], mistakes: me.mistakes };
    const correct = chinesePairId === questionId;

    if (!correct) {
      const nextRound: LocalRoundOverlay = { ...currentRound, mistakes: currentRound.mistakes + 1 };
      localRoundRef.current = nextRound;
      setRoom((current) => current && current.id === room.id && current.round === room.round
        ? {
            ...current,
            players: current.players.map((player) => player.id === playerId
              ? { ...player, mistakes: nextRound.mistakes }
              : player),
          }
        : current);
      setErrorPair({ zh: chinesePairId, en: questionId });
      setLiveMessage("Incorrect match. Input is locked for half a second.");
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => {
        setErrorPair(null);
        setSelectedZh(null);
      }, 500);
      void syncGameMatchProgress(room.id, room.round, nextRound.matchedIds, nextRound.mistakes).catch(() => {
        // The final completion submission contains the full local result.
      });
      return;
    }

    const nextMatchedIds = [...currentRound.matchedIds, chinesePairId];
    const complete = nextMatchedIds.length === questions.length;
    const runTimer = runClockRef.current;
    const durationMs = complete
      ? Math.max(250, Math.round(runTimer?.key === `${room.id}:${room.round}:${playerId}`
        ? eventTime - runTimer.startedAtPerformance
        : playerTime(me, room, serverClock)))
      : undefined;
    const completionId = complete ? crypto.randomUUID() : undefined;
    const nextRound: LocalRoundOverlay = {
      ...currentRound,
      matchedIds: nextMatchedIds,
      durationMs,
      completionId,
    };
    localRoundRef.current = nextRound;
    setSelectedZh(null);
    setErrorPair(null);
    setLiveMessage(complete ? "Set complete. Saving the result." : "Correct match.");
    setRoom((current) => current && current.id === room.id && current.round === room.round
      ? {
          ...current,
          status: complete ? "finished" : current.status,
          players: current.players.map((player) => player.id === playerId
            ? {
                ...player,
                progress: nextMatchedIds.length,
                matchedIds: nextMatchedIds,
                finishedAt: complete ? Date.now() : player.finishedAt,
                durationMs,
              }
            : player),
        }
      : current);

    if (!complete) {
      void syncGameMatchProgress(room.id, room.round, nextMatchedIds, nextRound.mistakes).catch(() => {
        // The final completion submission contains the full local result.
      });
      return;
    }

    setResultSyncing(true);
    void finishGameLocalRound(
      room.id,
      room.round,
      nextMatchedIds,
      nextRound.mistakes,
      durationMs!,
      completionId!,
    )
      .then(() => {
        setFormError("");
        queueRoomRefresh(room.id);
      })
      .catch(async (error) => {
        const rawMessage = error instanceof Error ? error.message : String(error);
        if (rawMessage.includes("room_not_playing") || rawMessage.includes("player_already_finished")) {
          localRoundRef.current = null;
          await refreshRoom(room.id).catch(() => undefined);
        }
        setFormError(friendlyGameError(error));
      })
      .finally(() => setResultSyncing(false));
  }

  async function startRematch() {
    if (!room || room.status !== "finished" || resultSyncing) return;
    setSelectedZh(null);
    setErrorPair(null);
    localRoundRef.current = null;
    runClockRef.current = null;
    setRunClock(null);
    setBusy(true);
    try {
      await startGameRematch(room.id);
      await refreshRoom(room.id);
    } catch (error) {
      setFormError(friendlyGameError(error));
    } finally {
      setBusy(false);
    }
  }

  function exitRoom() {
    window.sessionStorage.removeItem(SESSION_ROOM);
    if (room && playerId) window.sessionStorage.removeItem(`${RUN_CLOCK_PREFIX}${room.id}:${room.round}:${playerId}`);
    localRoundRef.current = null;
    runClockRef.current = null;
    setRoom(null);
    setQuestions(selectedQuestionSet.questions.slice(0, 6));
    setCode("");
    setFormError("");
    setLiveMessage("");
    setSelectedZh(null);
    setErrorPair(null);
    setRecordsOpen(false);
    setRunClock(null);
    setResultSyncing(false);
  }

  function selectMode(nextMode: RoomMode) {
    setMode(nextMode);
    setFormError("");
  }

  function openRecords(questionSetId: string) {
    setSoloLeaderboardLoading(true);
    setRecordsQuestionSetSlug(getQuestionSet(questionSetId)?.slug ?? QUESTION_SETS[0].slug);
    setRecordsOpen(true);
  }

  function selectRecordsQuestionSet(slug: QuestionSetSlug) {
    setSoloLeaderboardLoading(true);
    setRecordsQuestionSetSlug(slug);
  }

  if (!room || !me) {
    return (
      <>
        <main className="site-shell">
          <SiteHeader />
          <section className="hero" id="top">
          <div className="hero-copy">
            <h1>Find the right word.<br /><em>Train your instinct.</em></h1>
            <p className="intro">Practice alone or race a rival through a focused Chinese–English set designed to sharpen recall.</p>
          </div>

          <form className="lobby-card" onSubmit={joinRoom}>
            <div className="card-heading">
              <div><p>Choose Your Mode</p><h2>{mode === "race" ? "Enter The Arena" : "Solo Practice"}</h2></div>
              <span className="round-index">{mode === "race" ? "2P" : "1P"}</span>
            </div>

            <div className="mode-toggle" role="group" aria-label="Game Mode">
              <button type="button" className={mode === "race" ? "active" : ""} aria-pressed={mode === "race"} onClick={() => selectMode("race")}>Rival Match</button>
              <button type="button" className={mode === "practice" ? "active" : ""} aria-pressed={mode === "practice"} onClick={() => selectMode("practice")}>Solo Practice</button>
            </div>

            <label htmlFor="player-name">Your Nickname</label>
            <input
              id="player-name"
              value={name}
              maxLength={24}
              onChange={(event) => updateNickname(event.target.value)}
              placeholder="e.g. Night Owl"
              autoComplete="nickname"
            />

            <label htmlFor="question-set">Question Set</label>
            <CompositeDropdown
              id="question-set"
              value={questionSetSlug}
              options={QUESTION_SET_DROPDOWN_OPTIONS}
              onChange={setQuestionSetSlug}
            />

            <button className="primary-action" type="button" onClick={mode === "race" ? createRoom : startPractice} disabled={busy || booting}>
              <span>{mode === "race" ? "New Match" : "Solo Practice"}</span><b aria-hidden="true">↗</b>
            </button>

            <div className="mode-detail-panel">
              {mode === "race" ? (
                <div className="mode-support-panel">
                  <div className="mode-support-copy">
                    <strong>Join A Rival</strong>
                    <p>Enter the six-digit code shared by your rival.</p>
                  </div>
                  <div className="mode-support-row">
                    <input
                      id="room-code"
                      className="code-input"
                      aria-label="Room Code"
                      value={code}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                      placeholder="000 000"
                    />
                    <button type="submit" aria-label="Join Room" disabled={busy || booting}>Join Room</button>
                  </div>
                </div>
              ) : (
                <div className="mode-support-panel">
                  <div className="mode-support-copy">
                    <strong>Leaderboard</strong>
                    <p>See the ten fastest solo finishes.</p>
                  </div>
                  <div className="mode-support-row is-solo-action">
                    <button type="button" onClick={() => openRecords(questionSetSlug)}>View Records</button>
                  </div>
                </div>
              )}
            </div>

            {formError && <p className="form-error" role="alert">{formError}</p>}
          </form>
          </section>
        </main>
        {recordsOpen && (
          <RecordsDialog
            records={soloLeaderboard}
            loading={soloLeaderboardLoading}
            selectedSetSlug={recordsQuestionSet.slug}
            shared={hasSharedSoloLeaderboard()}
            onSelectSet={selectRecordsQuestionSet}
            onClose={() => setRecordsOpen(false)}
          />
        )}
      </>
    );
  }

  if (room.status === "expired") {
    return (
      <main className="arena-shell expired-shell">
        <SiteHeader onExit={exitRoom} />
        <section className="expired-stage">
          <p className="eyebrow"><span>Time</span> Room Closed</p>
          <h1>This room has expired.</h1>
          <p>Rooms stay active for five minutes. Start a fresh room to play again.</p>
          <button className="ready-button" type="button" onClick={exitRoom}><span>Return To Lobby</span><b>↗</b></button>
        </section>
      </main>
    );
  }

  if (room.status === "waiting") {
    return (
      <main className="arena-shell waiting-shell">
        <SiteHeader roomCode={room.code} onExit={exitRoom} />
        <section className="waiting-stage">
          <div className="waiting-intro">
            <p className="eyebrow"><span>Round {String(room.round).padStart(2, "0")}</span> Ready Room</p>
            <h1>{opponent ? "Your rival is here." : "Waiting for a rival."}</h1>
            <p>{opponent ? "Once both players are ready, the match begins after a three-second countdown." : "Open this page in a new browser tab and join with the room code."}</p>
          </div>

          <div className="room-code-card">
            <span>Room Code</span>
            <strong>{room.code.slice(0, 3)} {room.code.slice(3)}</strong>
            <button type="button" onClick={copyRoomCode}>{copied ? "Copied" : "Copy Code"}</button>
          </div>
          <p className="room-expiry">{roomQuestionSet.label} · Expires In {formatRoomLifetime(room.expiresAt - serverClock)}</p>

          <div className="versus-board">
            <PlayerReadyCard player={me} label="You" accent="acid" />
            <div className="versus-mark">VS</div>
            {opponent ? (
              <PlayerReadyCard player={opponent} label="Rival" accent="aqua" />
            ) : (
              <div className="player-ready-card empty-player">
                <div className="avatar-slot"><i /><i /><i /></div>
                <p>Rival</p><h2>Waiting To Join</h2><span className="player-state">Offline</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`ready-button ${me.ready ? "is-ready" : ""}`}
            onClick={toggleReady}
            disabled={!opponent || busy}
          >
            <span>{!opponent ? "Waiting For Rival" : me.ready ? "Cancel Ready" : "Ready"}</span>
            <b>{me.ready ? "Ready" : "Go"}</b>
          </button>
          {opponent && me.ready && !opponent.ready && <p className="ready-hint">Ready. Waiting for {opponent.name}…</p>}
        </section>
      </main>
    );
  }

  if (room.status === "countdown") {
    const remaining = Math.max(0, (room.countdownAt ?? serverClock) - serverClock);
    const count = Math.max(1, Math.min(3, Math.ceil(remaining / 1000)));
    return (
      <main className="countdown-screen">
        <div className="countdown-grid" aria-hidden="true" />
        <p>Round {String(room.round).padStart(2, "0")} · Get Ready</p>
        <div className="countdown-number" key={count}>{count}</div>
        <h1>{count === 1 ? "Lock in" : "The match is about to begin"}</h1>
        <div className="countdown-players"><span>{me.name}</span><i /> <span>{opponent?.name}</span></div>
      </main>
    );
  }

  if (room.status === "finished") {
    const standings = [...room.players].sort((left, right) => {
      if (Boolean(left.finishedAt) !== Boolean(right.finishedAt)) return left.finishedAt ? -1 : 1;
      if (!left.finishedAt && !right.finishedAt) return right.progress - left.progress || left.mistakes - right.mistakes;
      const timeDelta = playerTime(left, room, serverClock) - playerTime(right, room, serverClock);
      return timeDelta || left.mistakes - right.mistakes;
    });
    const winner = standings[0];
    const isPractice = room.mode === "practice";

    return (
      <>
        <main className="result-shell">
          <SiteHeader roomCode={isPractice ? undefined : room.code} />
          <section className="result-stage">
          <p className="eyebrow"><span>{isPractice ? "Practice" : "Result"}</span> {roomQuestionSet.label} · Round {String(room.round).padStart(2, "0")}</p>
          <div className="result-title">
            <span>{isPractice ? "Complete" : winner.id === playerId ? "Victory" : "Result"}</span>
            <h1>{isPractice ? "Set complete." : `${winner.name} wins.`}</h1>
          </div>

          <div className="standings">
            {standings.map((player, index) => (
              <article className={`standing-card ${player.id === playerId ? "is-me" : ""}`} key={player.id}>
                <div className="place">0{index + 1}</div>
                <div className="result-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
                <div className="standing-player"><span>{isPractice ? "Solo" : player.id === playerId ? "You" : "Rival"}</span><h2>{player.name}</h2></div>
                <div className="standing-stat"><span>Time</span><strong>{player.finishedAt ? formatTime(playerTime(player, room, serverClock)) : "DNF"}</strong></div>
                <div className="standing-stat"><span>Errors</span><strong>{String(player.mistakes).padStart(2, "0")}</strong></div>
              </article>
            ))}
          </div>

          <div className={`result-actions ${isPractice ? "is-practice" : ""}`}>
            <button className="primary-result" type="button" onClick={startRematch} disabled={busy || resultSyncing}><span>{isPractice ? "Practice Again" : "Play Again"}</span><b>↻</b></button>
            {isPractice && <button className="secondary-result" type="button" onClick={() => openRecords(room.questionSetId)}>View Records</button>}
            <button className="secondary-result" type="button" onClick={exitRoom}>Leave Room</button>
          </div>
          {resultSyncing && <p className="result-note">Saving the exact displayed time…</p>}
          {formError && <p className="result-note" role="alert">{formError}</p>}
          {!resultSyncing && !isPractice && !isHost && <p className="result-note">Either player can start a rematch.</p>}
          </section>
        </main>
        {isPractice && recordsOpen && (
          <RecordsDialog
            records={soloLeaderboard}
            loading={soloLeaderboardLoading}
            selectedSetSlug={recordsQuestionSet.slug}
            shared={hasSharedSoloLeaderboard()}
            onSelectSet={selectRecordsQuestionSet}
            onClose={() => setRecordsOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="compact-brand"><BrandIcon compact /><strong>Matching Rivals</strong></div>
        <div className="round-label">{room.mode === "practice" ? "Practice" : `Round ${String(room.round).padStart(2, "0")}`} <i /> {roomQuestionSet.label}{room.mode === "race" ? ` · Room ${room.code}` : ""}</div>
        <div className="game-tools">
          <div className="game-timer"><span>Time</span><strong>{formatTime(localPlayerTime)}</strong></div>
          <ThemeToggle />
        </div>
      </header>

      <section className={`score-ribbon ${room.mode === "practice" ? "is-solo" : ""}`} aria-label="Player Progress">
        <ProgressPlayer player={me} label="You" total={questions.length} />
        {room.mode === "race" && <div className="mini-versus">VS</div>}
        {room.mode === "race" && opponent && <ProgressPlayer player={opponent} label="Rival" total={questions.length} reverse />}
      </section>

      <section className="match-stage">
        <div className="match-heading">
          <div><p className="eyebrow"><span>{room.mode === "practice" ? "Practice" : "Match"}</span> {roomQuestionSet.label} · Chinese First, Then English</p><h1>{room.mode === "practice" ? "Complete the set at your pace." : "Find every matching pair."}</h1></div>
          <div className="match-status"><strong>{me.progress}/{questions.length}</strong><span>Complete</span></div>
        </div>

        <div className="match-board">
          <div className="word-column chinese-column">
            <div className="column-label"><span>ZH</span>Chinese</div>
            {chineseOrder.map((question, index) => {
              const matched = me.matchedIds.includes(question.id);
              const selected = selectedZh === question.id;
              const failed = errorPair?.zh === question.id;
              return (
                <button
                  type="button"
                  key={question.id}
                  className={`word-card ${matched ? "matched" : ""} ${selected ? "selected" : ""} ${failed ? "failed" : ""}`}
                  disabled={matched || Boolean(errorPair)}
                  onClick={() => chooseChinese(question.id)}
                  aria-pressed={selected}
                >
                  <span className="word-index">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{question.zh}</strong>
                  <i aria-hidden="true">{matched ? "✓" : ""}</i>
                </button>
              );
            })}
          </div>

          <div className="board-spine" aria-hidden="true"><span>Select</span><i /> <span>Match</span></div>

          <div className="word-column english-column">
            <div className="column-label"><span>EN</span>English</div>
            {englishOrder.map((question, index) => {
              const matched = me.matchedIds.includes(question.id);
              const failed = errorPair?.en === question.id;
              return (
                <button
                  type="button"
                  key={question.id}
                  className={`word-card ${matched ? "matched" : ""} ${failed ? "failed" : ""}`}
                  disabled={matched || !selectedZh || Boolean(errorPair)}
                  onClick={(event) => chooseEnglish(question.id, event.timeStamp)}
                >
                  <span className="word-index">{String.fromCharCode(65 + index)}</span>
                  <strong>{question.en}</strong>
                  <small>{titleCaseLabel(question.note)}</small>
                  <i aria-hidden="true">{matched ? "✓" : ""}</i>
                </button>
              );
            })}
          </div>
        </div>

        <div className="game-footer">
          <span>Errors <b>{me.mistakes}</b></span>
          <div className="game-progress"><i style={{ width: `${(me.progress / questions.length) * 100}%` }} /></div>
          <span>{me.progress === questions.length ? "Complete" : `${questions.length - me.progress} Pairs Left`}</span>
        </div>
        <p className="sr-only" aria-live="polite">{liveMessage}</p>
      </section>
    </main>
  );
}

function SiteHeader({ roomCode, onExit }: { roomCode?: string; onExit?: () => void }) {
  return (
    <nav className="topbar" aria-label="Main Navigation">
      <a className="brand" href="#top" aria-label="Matching Rivals Home">
        <BrandIcon /><span>Matching Rivals</span>
      </a>
      <div className="nav-actions">
        {roomCode && <span className="nav-room">Room {roomCode}</span>}
        <span className="demo-pill"><i /> {isLocalTestBackend() ? "Local Test" : "Live Beta"}</span>
        <ThemeToggle />
        {onExit && <button className="text-button" type="button" onClick={onExit}>Exit</button>}
      </div>
    </nav>
  );
}

function BrandIcon({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-mark ${compact ? "is-compact" : ""}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function ThemeToggle() {
  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("matching-rivals:theme", next);
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle Light And Dark Mode"
      title="Toggle Light And Dark Mode"
    >
      <span className="theme-icon theme-icon-moon" aria-hidden="true">☾</span>
      <span className="theme-icon theme-icon-sun" aria-hidden="true">☀</span>
    </button>
  );
}

function PlayerReadyCard({ player, label, accent }: { player: Player; label: string; accent: "acid" | "aqua" }) {
  return (
    <div className={`player-ready-card ${accent}`}>
      <div className="ready-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
      <p>{label}</p><h2>{player.name}</h2>
      <span className={`player-state ${player.ready ? "ready" : ""}`}>{player.ready ? "Ready" : "Not Ready"}</span>
    </div>
  );
}

function ProgressPlayer({ player, label, total, reverse = false }: { player: Player; label: string; total: number; reverse?: boolean }) {
  return (
    <div className={`progress-player ${reverse ? "reverse" : ""}`}>
      <div className="progress-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
      <div className="progress-copy"><span>{label} · {player.name}</span><div><i style={{ width: `${(player.progress / total) * 100}%` }} /></div></div>
      <strong>{player.progress}/{total}</strong>
    </div>
  );
}

function CompositeDropdown<T extends string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  compact = false,
}: {
  id: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  compact?: boolean;
}) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function closeAndFocusTrigger() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function chooseOption(option: DropdownOption<T>) {
    onChange(option.value);
    closeAndFocusTrigger();
  }

  function moveActive(delta: number) {
    setActiveIndex((current) => (current + delta + options.length) % options.length);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(event.key === "ArrowDown" ? selectedIndex : (selectedIndex - 1 + options.length) % options.length);
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusTrigger();
    }
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(options[index]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusTrigger();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={`composite-dropdown ${compact ? "is-compact" : ""} ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        id={id}
        ref={triggerRef}
        className="composite-dropdown-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => open ? setOpen(false) : openAt(selectedIndex)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="dropdown-trigger-copy">
          <strong>{selectedOption.label}</strong>
          {selectedOption.description && <small>{selectedOption.description}</small>}
        </span>
        <span className="dropdown-chevron" aria-hidden="true"><i /><i /></span>
      </button>

      {open && (
        <div className="composite-dropdown-menu" id={listboxId} role="listbox" aria-label={ariaLabel ?? "Question Set"}>
          {options.map((option, index) => (
            <button
              className={`composite-dropdown-option ${option.value === value ? "is-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={index === activeIndex ? 0 : -1}
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              onClick={() => chooseOption(option)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onPointerMove={() => setActiveIndex(index)}
            >
              <span className="dropdown-option-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="dropdown-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              <span className="dropdown-option-mark" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SoloLeaderboard({ records, loading }: {
  records: GameSoloRecord[];
  loading: boolean;
}) {
  return (
    <section className="solo-leaderboard" aria-label="Solo Leaderboard">
      {loading ? (
        <p className="leaderboard-empty">Loading Records...</p>
      ) : records.length ? (
        <ol>
          {records.map((record, index) => (
            <li className={index < 3 ? `podium rank-${index + 1}` : ""} key={record.id}>
              <span className="leaderboard-rank">{String(index + 1).padStart(2, "0")}</span>
              <strong title={record.nickname}>{record.nickname}</strong>
              <time>{formatTime(record.duration_ms)}</time>
              <small>{record.mistakes} Err</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="leaderboard-empty">No records yet. Set the first time.</p>
      )}
    </section>
  );
}

function RecordsDialog({
  records,
  loading,
  selectedSetSlug,
  shared,
  onSelectSet,
  onClose,
}: {
  records: GameSoloRecord[];
  loading: boolean;
  selectedSetSlug: QuestionSetSlug;
  shared: boolean;
  onSelectSet: (slug: QuestionSetSlug) => void;
  onClose: () => void;
}) {
  const selectedSet = getQuestionSet(selectedSetSlug) ?? QUESTION_SETS[0];

  return (
    <div className="records-modal-layer">
      <button className="records-backdrop" type="button" aria-label="Close Records" onClick={onClose} />
      <section className="records-dialog" role="dialog" aria-modal="true" aria-labelledby="records-title">
        <header>
          <div>
            <p><span>Solo Records</span></p>
            <h2 id="records-title">{selectedSet.label} Leaderboard</h2>
          </div>
          <button className="records-close" type="button" aria-label="Close Records" onClick={onClose}>×</button>
        </header>
        <div className="records-summary">
          <div>
            <p>{shared ? "Shared across all Matching Rivals players." : "Records stay in this browser until Supabase is configured."}</p>
            <span>Fastest 10</span>
          </div>
          <div className="records-set-picker">
            <span>Question Set</span>
            <CompositeDropdown
              id="record-question-set"
              ariaLabel="Record Question Set"
              value={selectedSetSlug}
              options={QUESTION_SET_DROPDOWN_OPTIONS}
              onChange={onSelectSet}
              compact
            />
          </div>
        </div>
        <SoloLeaderboard records={records} loading={loading} />
      </section>
    </div>
  );
}
