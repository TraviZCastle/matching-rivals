"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type RoomStatus = "waiting" | "countdown" | "playing" | "finished";

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
  code: string;
  status: RoomStatus;
  hostId: string;
  createdAt: number;
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

const QUESTIONS: Question[] = [
  { id: "q1", zh: "灵感", en: "inspiration", note: "noun" },
  { id: "q2", zh: "勇气", en: "courage", note: "noun" },
  { id: "q3", zh: "瞬间", en: "moment", note: "noun" },
  { id: "q4", zh: "边界", en: "boundary", note: "noun" },
  { id: "q5", zh: "探索", en: "explore", note: "verb" },
  { id: "q6", zh: "精准", en: "precise", note: "adjective" },
];

const STORAGE_PREFIX = "matching-rivals:room:";
const SESSION_ROOM = "matching-rivals:active-room";
const SESSION_PLAYER = "matching-rivals:player";
const CHANNEL_NAME = "matching-rivals:sync";

const NICKNAME_ADJECTIVES = ["Quiet", "Swift", "Cedar", "Silver", "Moss", "Dusk", "Night", "Calm"];
const NICKNAME_ANIMALS = ["Lynx", "Fox", "Heron", "Otter", "Owl", "Raven", "Koi", "Wolf"];

function randomNickname() {
  const adjective = NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)];
  const animal = NICKNAME_ANIMALS[Math.floor(Math.random() * NICKNAME_ANIMALS.length)];
  return `${adjective} ${animal}`;
}

function roomKey(code: string) {
  return `${STORAGE_PREFIX}${code}`;
}

function readRoom(code: string): Room | null {
  try {
    const value = window.localStorage.getItem(roomKey(code));
    return value ? (JSON.parse(value) as Room) : null;
  } catch {
    return null;
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!window.localStorage.getItem(roomKey(code))) return code;
  }
  return String(Date.now()).slice(-6);
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

function emptyPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    ready: false,
    progress: 0,
    mistakes: 0,
    matchedIds: [],
  };
}

function formatTime(milliseconds: number) {
  const safeValue = Math.max(0, milliseconds);
  const seconds = Math.floor(safeValue / 1000);
  const hundredths = Math.floor((safeValue % 1000) / 10);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes ? `${minutes}:` : ""}${minutes ? String(remainder).padStart(2, "0") : remainder}.${String(hundredths).padStart(2, "0")}`;
}

function playerTime(player: Player, room: Room, now: number) {
  if (!room.startedAt) return 0;
  return (player.finishedAt ?? now) - room.startedAt;
}

export default function Home() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [formError, setFormError] = useState("");
  const [selectedZh, setSelectedZh] = useState<string | null>(null);
  const [errorPair, setErrorPair] = useState<{ zh: string; en: string } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishRoom = useCallback((nextRoom: Room) => {
    window.localStorage.setItem(roomKey(nextRoom.code), JSON.stringify(nextRoom));
    setRoom(nextRoom);
    channelRef.current?.postMessage({ type: "room", room: nextRoom });
  }, []);

  const mutateRoom = useCallback(
    (targetCode: string, transform: (latest: Room) => Room) => {
      const latest = readRoom(targetCode);
      if (!latest) return null;
      const next = transform(latest);
      publishRoom(next);
      return next;
    },
    [publishRoom],
  );

  useEffect(() => {
    queueMicrotask(() => setName(randomNickname()));
    const savedCode = window.sessionStorage.getItem(SESSION_ROOM);
    const savedPlayer = window.sessionStorage.getItem(SESSION_PLAYER);
    if (savedCode && savedPlayer) {
      const savedRoom = readRoom(savedCode);
      if (savedRoom?.players.some((player) => player.id === savedPlayer)) {
        queueMicrotask(() => {
          setRoom(savedRoom);
          setPlayerId(savedPlayer);
        });
      } else {
        window.sessionStorage.removeItem(SESSION_ROOM);
        window.sessionStorage.removeItem(SESSION_PLAYER);
      }
    }

    const receiveRoom = (nextRoom: Room) => {
      const activeRoom = window.sessionStorage.getItem(SESSION_ROOM);
      if (activeRoom === nextRoom.code) setRoom(nextRoom);
    };

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<{ type: string; room?: Room }>) => {
        if (event.data.type === "room" && event.data.room) {
          receiveRoom(event.data.room);
        }
      };
      channelRef.current = channel;
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(STORAGE_PREFIX) || !event.newValue) return;
      try {
        receiveRoom(JSON.parse(event.newValue) as Room);
      } catch {
        // Ignore malformed local demo data.
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!room || (room.status !== "countdown" && room.status !== "playing")) {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 47);
    return () => window.clearInterval(timer);
  }, [room]);

  useEffect(() => {
    if (room?.status !== "countdown" || !room.countdownAt) return;
    const target = room.countdownAt;
    const timer = window.setTimeout(() => {
      mutateRoom(room.code, (latest) => {
        if (latest.status !== "countdown") return latest;
        return {
          ...latest,
          status: "playing",
          startedAt: latest.countdownAt ?? target,
        };
      });
    }, Math.max(0, target - Date.now()));
    return () => window.clearTimeout(timer);
  }, [room?.status, room?.countdownAt, room?.code, mutateRoom]);

  const me = room?.players.find((player) => player.id === playerId);
  const opponent = room?.players.find((player) => player.id !== playerId);
  const isHost = room?.hostId === playerId;

  const chineseOrder = useMemo(
    () => seededShuffle(QUESTIONS, `${room?.code}-${room?.round}-${playerId}-zh`),
    [room?.code, room?.round, playerId],
  );
  const englishOrder = useMemo(
    () => seededShuffle(QUESTIONS, `${room?.code}-${room?.round}-${playerId}-en`),
    [room?.code, room?.round, playerId],
  );

  function rememberSession(nextRoom: Room, nextPlayerId: string) {
    window.sessionStorage.setItem(SESSION_ROOM, nextRoom.code);
    window.sessionStorage.setItem(SESSION_PLAYER, nextPlayerId);
    setPlayerId(nextPlayerId);
    setRoom(nextRoom);
  }

  function validateName() {
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError("Enter a nickname before starting a match.");
      return null;
    }
    return cleanName;
  }

  function createRoom() {
    const cleanName = validateName();
    if (!cleanName) return;
    const nextPlayerId = makeId();
    const nextRoom: Room = {
      code: makeRoomCode(),
      status: "waiting",
      hostId: nextPlayerId,
      createdAt: Date.now(),
      round: 1,
      players: [emptyPlayer(nextPlayerId, cleanName)],
    };
    setFormError("");
    rememberSession(nextRoom, nextPlayerId);
    publishRoom(nextRoom);
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    const cleanName = validateName();
    if (!cleanName) return;
    if (code.length !== 6) {
      setFormError("Enter the complete six-digit room code.");
      return;
    }
    const target = readRoom(code);
    if (!target) {
      setFormError("Room not found. Check the code with your rival.");
      return;
    }
    if (target.players.length >= 2) {
      setFormError("This room already has two players.");
      return;
    }
    if (target.status !== "waiting") {
      setFormError("This match has already started.");
      return;
    }

    const nextPlayerId = makeId();
    const nextRoom = {
      ...target,
      players: [...target.players, emptyPlayer(nextPlayerId, cleanName)],
    };
    setFormError("");
    rememberSession(nextRoom, nextPlayerId);
    publishRoom(nextRoom);
  }

  function toggleReady() {
    if (!room || !me || room.status !== "waiting") return;
    mutateRoom(room.code, (latest) => {
      const players = latest.players.map((player) =>
        player.id === playerId ? { ...player, ready: !player.ready } : player,
      );
      const allReady = players.length === 2 && players.every((player) => player.ready);
      return {
        ...latest,
        players,
        status: allReady ? "countdown" : "waiting",
        countdownAt: allReady ? Date.now() + 3200 : undefined,
      };
    });
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

  function chooseEnglish(questionId: string) {
    if (!room || room.status !== "playing" || me?.finishedAt || errorPair) return;
    if (!selectedZh || me?.matchedIds.includes(questionId)) return;

    if (selectedZh !== questionId) {
      const failedPair = { zh: selectedZh, en: questionId };
      setErrorPair(failedPair);
      setLiveMessage("Incorrect match. Input is locked for half a second.");
      mutateRoom(room.code, (latest) => ({
        ...latest,
        players: latest.players.map((player) =>
          player.id === playerId
            ? { ...player, mistakes: player.mistakes + 1 }
            : player,
        ),
      }));
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => {
        setErrorPair(null);
        setSelectedZh(null);
      }, 500);
      return;
    }

    setSelectedZh(null);
    setErrorPair(null);
    setLiveMessage("Correct match.");
    mutateRoom(room.code, (latest) => {
      const players = latest.players.map((player) => {
        if (player.id !== playerId || player.matchedIds.includes(questionId)) {
          return player;
        }
        const matchedIds = [...player.matchedIds, questionId];
        const isComplete = matchedIds.length === QUESTIONS.length;
        return {
          ...player,
          matchedIds,
          progress: matchedIds.length,
          finishedAt: isComplete ? Date.now() : undefined,
        };
      });
      const allFinished = players.length === 2 && players.every((player) => player.finishedAt);
      return {
        ...latest,
        players,
        status: allFinished ? "finished" : latest.status,
      };
    });
  }

  function startRematch() {
    if (!room || room.status !== "finished") return;
    setSelectedZh(null);
    setErrorPair(null);
    mutateRoom(room.code, (latest) => ({
      ...latest,
      status: "waiting",
      round: latest.round + 1,
      countdownAt: undefined,
      startedAt: undefined,
      players: latest.players.map((player) => ({
        ...player,
        ready: false,
        progress: 0,
        mistakes: 0,
        matchedIds: [],
        finishedAt: undefined,
      })),
    }));
  }

  function exitRoom() {
    if (room) {
      const latest = readRoom(room.code);
      if (latest) {
        const players = latest.players.filter((player) => player.id !== playerId);
        if (players.length === 0) {
          window.localStorage.removeItem(roomKey(room.code));
        } else if (latest.status === "waiting" || latest.status === "finished") {
          publishRoom({
            ...latest,
            hostId: players[0].id,
            status: "waiting",
            countdownAt: undefined,
            startedAt: undefined,
            players: players.map((player) => ({
              ...player,
              ready: false,
              progress: 0,
              mistakes: 0,
              matchedIds: [],
              finishedAt: undefined,
            })),
          });
        }
      }
    }
    window.sessionStorage.removeItem(SESSION_ROOM);
    window.sessionStorage.removeItem(SESSION_PLAYER);
    setRoom(null);
    setPlayerId("");
    setName(randomNickname());
    setCode("");
    setFormError("");
    setSelectedZh(null);
    setErrorPair(null);
  }

  if (!room || !me) {
    return (
      <main className="site-shell">
        <SiteHeader />
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow"><span>01</span> HEAD-TO-HEAD WORD RACE</p>
            <h1>Find the right word.<br /><em>Beat your rival.</em></h1>
            <p className="intro">The same Chinese–English set, two players, and one focused race that takes less than two minutes.</p>
            <div className="feature-row" aria-label="Match features">
              <span><b>06</b> word pairs</span>
              <span><b>2P</b> live sync</span>
              <span><b>MS</b> precision timing</span>
            </div>
          </div>

          <form className="lobby-card" onSubmit={joinRoom}>
            <div className="card-heading">
              <div><p>READY ROOM</p><h2>Enter the arena</h2></div>
              <span className="round-index">1/2</span>
            </div>

            <label htmlFor="player-name">Your nickname</label>
            <input
              id="player-name"
              value={name}
              maxLength={12}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Night Owl"
              autoComplete="nickname"
            />

            <button className="primary-action" type="button" onClick={createRoom}>
              <span>Create a new match</span><b aria-hidden="true">↗</b>
            </button>

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
              <button type="submit" aria-label="Join room">Join</button>
            </div>

            {formError && <p className="form-error" role="alert">{formError}</p>}
            <p className="privacy-note"><span aria-hidden="true">◇</span> Local mode never uploads personal data</p>
          </form>
        </section>

        <section className="how-it-works" aria-labelledby="how-title">
          <div><p className="eyebrow"><span>02</span> HOW IT WORKS</p><h2 id="how-title">Settle it in three steps</h2></div>
          <ol>
            <li><b>01</b><span><strong>Invite a rival</strong>Share the six-digit room code</span></li>
            <li><b>02</b><span><strong>Start together</strong>The countdown begins when both are ready</span></li>
            <li><b>03</b><span><strong>Match quickly</strong>The fastest player wins the round</span></li>
          </ol>
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
            disabled={!opponent}
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
    const remaining = Math.max(0, (room.countdownAt ?? clock) - clock);
    const count = Math.max(1, Math.ceil(remaining / 1000));
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

  if (room.status === "playing" && me.finishedAt) {
    return (
      <main className="finish-wait-screen">
        <div className="finish-orbit" aria-hidden="true"><i /><i /><i /></div>
        <p className="eyebrow"><span>FINISH</span> TIME LOCKED</p>
        <h1>{formatTime(playerTime(me, room, clock))}</h1>
        <p>{me.mistakes} errors · Waiting for {opponent?.name} to finish</p>
        <div className="opponent-progress"><i style={{ width: `${((opponent?.progress ?? 0) / QUESTIONS.length) * 100}%` }} /></div>
        <strong>{opponent?.progress ?? 0} / {QUESTIONS.length}</strong>
      </main>
    );
  }

  if (room.status === "finished") {
    const standings = [...room.players].sort((left, right) => {
      const timeDelta = playerTime(left, room, clock) - playerTime(right, room, clock);
      return timeDelta || left.mistakes - right.mistakes;
    });
    const winner = standings[0];
    const tie = standings.length === 2
      && playerTime(standings[0], room, clock) === playerTime(standings[1], room, clock)
      && standings[0].mistakes === standings[1].mistakes;

    return (
      <main className="result-shell">
        <SiteHeader roomCode={room.code} />
        <section className="result-stage">
          <p className="eyebrow"><span>RESULT</span> ROUND {String(room.round).padStart(2, "0")}</p>
          <div className="result-title"><span>{tie ? "DRAW" : winner.id === playerId ? "VICTORY" : "RESULT"}</span><h1>{tie ? "Evenly matched." : `${winner.name} wins.`}</h1></div>

          <div className="standings">
            {standings.map((player, index) => (
              <article className={`standing-card ${player.id === playerId ? "is-me" : ""}`} key={player.id}>
                <div className="place">0{index + 1}</div>
                <div className="result-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
                <div className="standing-player"><span>{player.id === playerId ? "YOU" : "RIVAL"}</span><h2>{player.name}</h2></div>
                <div className="standing-stat"><span>TIME</span><strong>{formatTime(playerTime(player, room, clock))}</strong></div>
                <div className="standing-stat"><span>ERRORS</span><strong>{String(player.mistakes).padStart(2, "0")}</strong></div>
              </article>
            ))}
          </div>

          <div className="result-actions">
            <button className="primary-result" type="button" onClick={startRematch}><span>Play again</span><b>↻</b></button>
            <button className="secondary-result" type="button" onClick={exitRoom}>Leave room</button>
          </div>
          {!isHost && <p className="result-note">Either player can start a rematch.</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="compact-brand"><BrandIcon compact /><strong>Matching Rivals</strong></div>
        <div className="round-label">ROUND {String(room.round).padStart(2, "0")} <i /> ROOM {room.code}</div>
        <div className="game-tools">
          <div className="game-timer"><span>TIME</span><strong>{formatTime(playerTime(me, room, clock))}</strong></div>
          <ThemeToggle />
        </div>
      </header>

      <section className="score-ribbon" aria-label="Player progress">
        <ProgressPlayer player={me} label="YOU" />
        <div className="mini-versus">VS</div>
        {opponent && <ProgressPlayer player={opponent} label="RIVAL" reverse />}
      </section>

      <section className="match-stage">
        <div className="match-heading">
          <div><p className="eyebrow"><span>MATCH</span> CHINESE FIRST, THEN ENGLISH</p><h1>Find every matching pair.</h1></div>
          <div className="match-status"><strong>{me.progress}/{QUESTIONS.length}</strong><span>COMPLETE</span></div>
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
                  disabled={matched || !selectedZh || Boolean(errorPair)}
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
          <div className="game-progress"><i style={{ width: `${(me.progress / QUESTIONS.length) * 100}%` }} /></div>
          <span>{me.progress === QUESTIONS.length ? "COMPLETE" : `${QUESTIONS.length - me.progress} PAIRS LEFT`}</span>
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
        <span className="demo-pill"><i /> LOCAL DEMO</span>
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

function ProgressPlayer({ player, label, reverse = false }: { player: Player; label: string; reverse?: boolean }) {
  return (
    <div className={`progress-player ${reverse ? "reverse" : ""}`}>
      <div className="progress-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
      <div className="progress-copy"><span>{label} · {player.name}</span><div><i style={{ width: `${(player.progress / QUESTIONS.length) * 100}%` }} /></div></div>
      <strong>{player.progress}/{QUESTIONS.length}</strong>
    </div>
  );
}
