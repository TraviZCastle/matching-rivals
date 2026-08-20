"use client";

import {
  FormEvent,
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
  hasGameConfig,
  isLocalTestBackend,
  joinGameRoom,
  loadGameRoom,
  openGameRound,
  setGameReady,
  startGameRematch,
  submitGameMatch,
  subscribeToGameRoom,
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

const QUESTIONS: Question[] = getQuestionSet("cet4")?.questions ?? [];

const SESSION_ROOM = "matching-rivals:active-room";

const NICKNAME_ADJECTIVES = ["Quiet", "Swift", "Cedar", "Silver", "Moss", "Dusk", "Night", "Calm"];
const NICKNAME_ANIMALS = ["Lynx", "Fox", "Heron", "Otter", "Owl", "Raven", "Koi", "Wolf"];

function randomNickname() {
  const adjective = NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)];
  const animal = NICKNAME_ANIMALS[Math.floor(Math.random() * NICKNAME_ANIMALS.length)];
  return `${adjective} ${animal}`;
}

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
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshRoom = useCallback(async (roomId: string) => {
    const snapshot = await loadGameRoom(roomId);
    const mapped = mapGameSnapshot(snapshot);
    const measuredAt = Date.now();
    setRoom(mapped.room);
    setQuestions(mapped.questions);
    setServerClockOffset(Date.parse(snapshot.serverNow) - snapshot.clientClockSampledAt);
    setClock(measuredAt);
    return mapped.room;
  }, []);

  useEffect(() => {
    queueMicrotask(() => setName(randomNickname()));
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
    };
  }, [refreshRoom]);

  useEffect(() => {
    if (!room?.id || !playerId) return;
    const roomId = room.id;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void subscribeToGameRoom(roomId, async () => {
      try {
        await refreshRoom(roomId);
      } catch (error) {
        const message = friendlyGameError(error);
        setFormError(message);
        setLiveMessage(message);
      }
    })
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
  }, [room?.id, playerId, refreshRoom]);

  useEffect(() => {
    if (!room || room.status === "finished" || room.status === "expired") {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 47);
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
    await refreshRoom(roomId);
  }

  function validateName() {
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError("Enter a nickname before continuing.");
      return null;
    }
    return cleanName;
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
    if (!room || room.status !== "playing" || me?.finishedAt || errorPair || busy) return;
    if (me?.matchedIds.includes(questionId)) return;
    setSelectedZh((current) => (current === questionId ? null : questionId));
    setErrorPair(null);
    setLiveMessage("Chinese word selected. Choose its English match.");
  }

  async function chooseEnglish(questionId: string) {
    if (!room || room.status !== "playing" || me?.finishedAt || errorPair || busy) return;
    if (!selectedZh || me?.matchedIds.includes(questionId)) return;
    const chinesePairId = selectedZh;
    setBusy(true);
    try {
      const result = await submitGameMatch(room.id, chinesePairId, questionId);
      if (!result.correct) {
        setErrorPair({ zh: chinesePairId, en: questionId });
        setLiveMessage("Incorrect match. Input is locked for half a second.");
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => {
          setErrorPair(null);
          setSelectedZh(null);
        }, 500);
      } else {
        setSelectedZh(null);
        setErrorPair(null);
        setLiveMessage("Correct match.");
      }
      await refreshRoom(room.id);
    } catch (error) {
      setFormError(friendlyGameError(error));
    } finally {
      setBusy(false);
    }
  }

  async function startRematch() {
    if (!room || room.status !== "finished") return;
    setSelectedZh(null);
    setErrorPair(null);
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
    setRoom(null);
    setQuestions(selectedQuestionSet.questions);
    setName(randomNickname());
    setCode("");
    setFormError("");
    setLiveMessage("");
    setSelectedZh(null);
    setErrorPair(null);
  }

  if (!room || !me) {
    return (
      <main className="site-shell">
        <SiteHeader />
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow"><span>01</span> RACE OR PRACTICE</p>
            <h1>Find the right word.<br /><em>Train your instinct.</em></h1>
            <p className="intro">Practice alone or race a rival through a focused Chinese–English set before the five-minute room closes.</p>
            <div className="feature-row" aria-label="Match features">
              <span><b>06</b> word pairs</span>
              <span><b>05</b> question sets</span>
              <span><b>5M</b> room lifetime</span>
            </div>
          </div>

          <form className="lobby-card" onSubmit={joinRoom}>
            <div className="card-heading">
              <div><p>CHOOSE YOUR MODE</p><h2>{mode === "race" ? "Enter the arena" : "Solo practice"}</h2></div>
              <span className="round-index">{mode === "race" ? "2P" : "1P"}</span>
            </div>

            <div className="mode-toggle" role="group" aria-label="Game mode">
              <button type="button" className={mode === "race" ? "active" : ""} aria-pressed={mode === "race"} onClick={() => setMode("race")}>Rival match</button>
              <button type="button" className={mode === "practice" ? "active" : ""} aria-pressed={mode === "practice"} onClick={() => setMode("practice")}>Solo practice</button>
            </div>

            <label htmlFor="player-name">Your nickname</label>
            <input
              id="player-name"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Night Owl"
              autoComplete="nickname"
            />

            <label htmlFor="question-set">Question set</label>
            <select id="question-set" value={questionSetSlug} onChange={(event) => setQuestionSetSlug(event.target.value as QuestionSetSlug)}>
              {QUESTION_SETS.map((set) => <option value={set.slug} key={set.slug}>{set.label} · {set.description}</option>)}
            </select>

            <button className="primary-action" type="button" onClick={mode === "race" ? createRoom : startPractice} disabled={busy || booting}>
              <span>{mode === "race" ? "Create a rival match" : "Start solo practice"}</span><b aria-hidden="true">↗</b>
            </button>

            {mode === "race" && <>
              <div className="or"><span />OR JOIN A RIVAL<span /></div>

              <label htmlFor="room-code">Six-digit room code</label>
              <div className="join-row">
                <input
                  id="room-code"
                  className="code-input"
                  value={code}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="000 000"
                />
                <button type="submit" aria-label="Join room" disabled={busy || booting}>Join</button>
              </div>
            </>}

            {formError && <p className="form-error" role="alert">{formError}</p>}
            <p className="privacy-note"><span aria-hidden="true">◇</span> {isLocalTestBackend() ? "Local test data · This browser only" : "Anonymous session · No email required"}</p>
          </form>
        </section>

        <section className="how-it-works" aria-labelledby="how-title">
          <div><p className="eyebrow"><span>02</span> HOW IT WORKS</p><h2 id="how-title">Choose your own pace</h2></div>
          <ol>
            <li><b>01</b><span><strong>Pick a set</strong>Choose CET-4, CET-6, TEM-8, IELTS, or TOEFL</span></li>
            <li><b>02</b><span><strong>Choose a mode</strong>Practice alone or invite a rival</span></li>
            <li><b>03</b><span><strong>Finish first</strong>The race ends as soon as one player completes every pair</span></li>
          </ol>
        </section>
      </main>
    );
  }

  if (room.status === "expired") {
    return (
      <main className="arena-shell expired-shell">
        <SiteHeader onExit={exitRoom} />
        <section className="expired-stage">
          <p className="eyebrow"><span>TIME</span> ROOM CLOSED</p>
          <h1>This room has expired.</h1>
          <p>Rooms stay active for five minutes. Start a fresh room to play again.</p>
          <button className="ready-button" type="button" onClick={exitRoom}><span>Return to lobby</span><b>↗</b></button>
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
            <p className="eyebrow"><span>ROUND {String(room.round).padStart(2, "0")}</span> READY ROOM</p>
            <h1>{opponent ? "Your rival is here." : "Waiting for a rival."}</h1>
            <p>{opponent ? "Once both players are ready, the match begins after a three-second countdown." : "Open this page in a new browser tab and join with the room code."}</p>
          </div>

          <div className="room-code-card">
            <span>ROOM CODE</span>
            <strong>{room.code.slice(0, 3)} {room.code.slice(3)}</strong>
            <button type="button" onClick={copyRoomCode}>{copied ? "COPIED" : "COPY CODE"}</button>
          </div>
          <p className="room-expiry">{roomQuestionSet.label} · ROOM EXPIRES IN {formatRoomLifetime(room.expiresAt - serverClock)}</p>

          <div className="versus-board">
            <PlayerReadyCard player={me} label="YOU" accent="acid" />
            <div className="versus-mark"><span>V</span><span>S</span></div>
            {opponent ? (
              <PlayerReadyCard player={opponent} label="RIVAL" accent="aqua" />
            ) : (
              <div className="player-ready-card empty-player">
                <div className="avatar-slot"><i /><i /><i /></div>
                <p>RIVAL</p><h2>Waiting to join</h2><span className="player-state">OFFLINE</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`ready-button ${me.ready ? "is-ready" : ""}`}
            onClick={toggleReady}
            disabled={!opponent || busy}
          >
            <span>{!opponent ? "Waiting for a rival" : me.ready ? "Cancel ready" : "I'm ready"}</span>
            <b>{me.ready ? "READY" : "GO"}</b>
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
        <p>ROUND {String(room.round).padStart(2, "0")} · GET READY</p>
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
      <main className="result-shell">
        <SiteHeader roomCode={isPractice ? undefined : room.code} />
        <section className="result-stage">
          <p className="eyebrow"><span>{isPractice ? "PRACTICE" : "RESULT"}</span> {roomQuestionSet.label} · ROUND {String(room.round).padStart(2, "0")}</p>
          <div className="result-title">
            <span>{isPractice ? "COMPLETE" : winner.id === playerId ? "VICTORY" : "RESULT"}</span>
            <h1>{isPractice ? "Set complete." : `${winner.name} wins.`}</h1>
          </div>

          <div className="standings">
            {standings.map((player, index) => (
              <article className={`standing-card ${player.id === playerId ? "is-me" : ""}`} key={player.id}>
                <div className="place">0{index + 1}</div>
                <div className="result-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
                <div className="standing-player"><span>{isPractice ? "SOLO" : player.id === playerId ? "YOU" : "RIVAL"}</span><h2>{player.name}</h2></div>
                <div className="standing-stat"><span>TIME</span><strong>{player.finishedAt ? formatTime(playerTime(player, room, serverClock)) : "DNF"}</strong></div>
                <div className="standing-stat"><span>ERRORS</span><strong>{String(player.mistakes).padStart(2, "0")}</strong></div>
              </article>
            ))}
          </div>

          <div className="result-actions">
            <button className="primary-result" type="button" onClick={startRematch} disabled={busy}><span>{isPractice ? "Practice again" : "Play again"}</span><b>↻</b></button>
            <button className="secondary-result" type="button" onClick={exitRoom}>Leave room</button>
          </div>
          {!isPractice && !isHost && <p className="result-note">Either player can start a rematch.</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="compact-brand"><BrandIcon compact /><strong>Matching Rivals</strong></div>
        <div className="round-label">{room.mode === "practice" ? "PRACTICE" : `ROUND ${String(room.round).padStart(2, "0")}`} <i /> {roomQuestionSet.label}{room.mode === "race" ? ` · ROOM ${room.code}` : ""}</div>
        <div className="game-tools">
          <div className="game-timer"><span>TIME</span><strong>{formatTime(playerTime(me, room, serverClock))}</strong></div>
          <ThemeToggle />
        </div>
      </header>

      <section className={`score-ribbon ${room.mode === "practice" ? "is-solo" : ""}`} aria-label="Player progress">
        <ProgressPlayer player={me} label="YOU" total={questions.length} />
        {room.mode === "race" && <div className="mini-versus">VS</div>}
        {room.mode === "race" && opponent && <ProgressPlayer player={opponent} label="RIVAL" total={questions.length} reverse />}
      </section>

      <section className="match-stage">
        <div className="match-heading">
          <div><p className="eyebrow"><span>{room.mode === "practice" ? "PRACTICE" : "MATCH"}</span> {roomQuestionSet.label} · CHINESE FIRST, THEN ENGLISH</p><h1>{room.mode === "practice" ? "Complete the set at your pace." : "Find every matching pair."}</h1></div>
          <div className="match-status"><strong>{me.progress}/{questions.length}</strong><span>COMPLETE</span></div>
        </div>

        <div className="match-board">
          <div className="word-column chinese-column">
            <div className="column-label"><span>ZH</span>CHINESE</div>
            {chineseOrder.map((question, index) => {
              const matched = me.matchedIds.includes(question.id);
              const selected = selectedZh === question.id;
              const failed = errorPair?.zh === question.id;
              return (
                <button
                  type="button"
                  key={question.id}
                  className={`word-card ${matched ? "matched" : ""} ${selected ? "selected" : ""} ${failed ? "failed" : ""}`}
                  disabled={matched || Boolean(errorPair) || busy}
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

          <div className="board-spine" aria-hidden="true"><span>SELECT</span><i /> <span>MATCH</span></div>

          <div className="word-column english-column">
            <div className="column-label"><span>EN</span>ENGLISH</div>
            {englishOrder.map((question, index) => {
              const matched = me.matchedIds.includes(question.id);
              const failed = errorPair?.en === question.id;
              return (
                <button
                  type="button"
                  key={question.id}
                  className={`word-card ${matched ? "matched" : ""} ${failed ? "failed" : ""}`}
                  disabled={matched || !selectedZh || Boolean(errorPair) || busy}
                  onClick={() => chooseEnglish(question.id)}
                >
                  <span className="word-index">{String.fromCharCode(65 + index)}</span>
                  <strong>{question.en}</strong>
                  <small>{question.note}</small>
                  <i aria-hidden="true">{matched ? "✓" : ""}</i>
                </button>
              );
            })}
          </div>
        </div>

        <div className="game-footer">
          <span>ERRORS <b>{me.mistakes}</b></span>
          <div className="game-progress"><i style={{ width: `${(me.progress / questions.length) * 100}%` }} /></div>
          <span>{me.progress === questions.length ? "COMPLETE" : `${questions.length - me.progress} PAIRS LEFT`}</span>
        </div>
        <p className="sr-only" aria-live="polite">{liveMessage}</p>
      </section>
    </main>
  );
}

function SiteHeader({ roomCode, onExit }: { roomCode?: string; onExit?: () => void }) {
  return (
    <nav className="topbar" aria-label="Main navigation">
      <a className="brand" href="#top" aria-label="Matching Rivals home">
        <BrandIcon /><span>Matching Rivals</span>
      </a>
      <div className="nav-actions">
        {roomCode && <span className="nav-room">ROOM {roomCode}</span>}
        <span className="demo-pill"><i /> {isLocalTestBackend() ? "LOCAL TEST" : "LIVE BETA"}</span>
        <ThemeToggle />
        {onExit && <button className="text-button" type="button" onClick={onExit}>EXIT</button>}
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
      aria-label="Toggle light and dark mode"
      title="Toggle light and dark mode"
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
      <span className={`player-state ${player.ready ? "ready" : ""}`}>{player.ready ? "READY" : "NOT READY"}</span>
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
