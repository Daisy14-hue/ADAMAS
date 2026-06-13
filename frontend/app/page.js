'use client';

import { useEffect, useRef, useState } from 'react';
import { getSocket, emit } from '@/lib/socket';
import { Landing, NameScreen, Hub, RoomEntry, Lobby } from '@/components/Screens';
import GameBoard from '@/components/GameBoard';

const ERRORS = {
  ROOM_NOT_FOUND: 'No room with that code.',
  MATCH_ALREADY_STARTED: 'That match has already started.',
  ROOM_FULL: 'That room is full (max 10).',
  NOT_HOST: 'Only the host can do that.',
  NEED_AT_LEAST_2_PLAYERS: 'Need at least 2 players to start.',
  NOT_YOUR_TURN: 'Not your turn.',
  ILLEGAL_MOVE: "You can't play that card.",
  ILLEGAL_STACK_RESPONSE: 'That card can’t answer a draw stack.',
  NON_ASCENDING_DRAW: 'Draw cards must stack ascending (≥ previous).',
  CANNOT_DEFLECT_WILD_DRAW: 'Wild draws can’t be reversed — stack or take it.',
  REVERSE_MUST_MATCH_COLOR: 'Reverse must match the active color to deflect.',
  YOU_HAVE_A_PLAYABLE_CARD: 'You have a playable card — play it.',
  MUST_PLAY_DRAWN_CARD: 'Play the card you just drew.',
  COLOR_REQUIRED: 'Choose a color.',
  ROULETTE_COLOR_REQUIRED: 'Call a color for the roulette.',
  NOTHING_TO_PASS: 'Nothing to pass — draw first.',
  CANNOT_PASS_DURING_STACK: 'You can’t pass a draw stack — stack, deflect, or take it.',
};

// Cheeky one-liners for the "Coming Soon" gag (pick one at random).
const COMING_SOON_GAGS = [
  'Our hamsters are coding as fast as their little legs allow. 🐹',
  'Locked tighter than your hand when you forget to yell “UNO!”. 🔒',
  'Coming soon™ — and that tiny ™ is doing a LOT of heavy lifting.',
  'It’s not done. It’s “artisanally unfinished.” 🎨',
  'We pinky-promised the deadline. The pinky has since filed a complaint. 🤙',
  'Patience, champion. Even Draw 10 needed time to become this cruel.',
  'This tile is in witness protection. New identity drops later. 🕶️',
];
const randomGag = () => COMING_SOON_GAGS[Math.floor(Math.random() * COMING_SOON_GAGS.length)];

// ---- localStorage session (pid per room) ----------------------------------
const LS_LAST = 'adamas:lastRoom';
const LS_NAME = 'adamas:name';
const pidKey = (code) => `adamas:pid:${code}`;
const hasLS = () => typeof window !== 'undefined' && !!window.localStorage;

const saveSession = (code, pid, name) => {
  if (!hasLS()) return;
  localStorage.setItem(pidKey(code), pid);
  localStorage.setItem(LS_LAST, code);
  if (name) localStorage.setItem(LS_NAME, name);
};
const loadSession = () => {
  if (!hasLS()) return null;
  const code = localStorage.getItem(LS_LAST);
  const name = localStorage.getItem(LS_NAME);
  const pid = code ? localStorage.getItem(pidKey(code)) : null;
  return code && pid ? { code, pid, name } : null;
};
const clearSession = (code) => {
  if (!hasLS()) return;
  if (code) localStorage.removeItem(pidKey(code));
  localStorage.removeItem(LS_LAST);
};

export default function Home() {
  const [name, setName] = useState('');
  const [screen, setScreen] = useState('landing'); // landing|name|hub|entry|lobby|game
  const [gameType, setGameType] = useState('noMercy');
  const [gag, setGag] = useState(null); // { title, msg } for the Coming Soon popup
  const [room, setRoom] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [view, setView] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const afterName = useRef(null);

  // refs so the once-mounted socket effect reads current values
  const nameRef = useRef('');
  const roomCodeRef = useRef(null);
  const playerIdRef = useRef(null);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);

  const toast = (msg, kind = 'err') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };

  const resetToHub = () => {
    clearSession(roomCodeRef.current);
    setRoom(null);
    setRoomCode(null);
    setView(null);
    setScreen('hub');
  };

  // ---- socket lifecycle (mounted once) ----
  useEffect(() => {
    const s = getSocket();

    const tryRejoin = async () => {
      // Prefer the active room; fall back to a saved session (page reload).
      const active = roomCodeRef.current;
      const saved = loadSession();
      const code = active || (saved && saved.code);
      const pid = active ? (hasLS() && localStorage.getItem(pidKey(active))) : saved && saved.pid;
      const nm = nameRef.current || (saved && saved.name) || '';
      if (!code || !pid) { setReconnecting(false); return; }
      setReconnecting(true);
      const res = await emit('joinRoom', { name: nm, code, pid });
      if (res.ok) {
        setName((n) => n || nm);
        setPlayerId(res.pid);
        setRoom((r) => r || { code });
        setRoomCode(code);
        saveSession(code, res.pid, nm);
        setScreen((sc) => (sc === 'game' ? sc : 'lobby'));
      } else {
        clearSession(code);
        if (active) toast('Lost the room — it may have ended.', 'info');
      }
      setReconnecting(false);
    };

    const onConnect = () => { tryRejoin(); };
    const onDisconnect = () => { if (roomCodeRef.current) setReconnecting(true); };
    const onLobby = (data) => { setRoom(data); if (data.code) setRoomCode(data.code); };
    const onState = ({ view: v }) => { setView(v); setScreen('game'); };
    const onEnded = ({ reason }) => {
      toast(reason === 'PLAYER_REMOVED' || reason === 'PLAYER_DISCONNECTED'
        ? 'A player dropped and didn’t return — match ended.'
        : reason === 'PLAYER_LEFT' ? 'A player left — match ended.' : 'Match ended.', 'info');
      resetToHub();
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('lobby', onLobby);
    s.on('state', onState);
    s.on('ended', onEnded);
    if (s.connected) tryRejoin(); // already connected before listeners attached

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('lobby', onLobby);
      s.off('state', onState);
      s.off('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- actions ----
  const goPlay = () => {
    if (name) setScreen('hub');
    else { afterName.current = 'hub'; setScreen('name'); }
  };
  const submitName = (n) => {
    setName(n);
    if (hasLS()) localStorage.setItem(LS_NAME, n);
    const next = afterName.current || 'hub';
    afterName.current = null;
    setScreen(next);
  };

  const createRoom = async () => {
    setBusy(true);
    const res = await emit('createRoom', { name, gameType });
    setBusy(false);
    if (!res.ok) return toast(ERRORS[res.error] || res.error);
    setPlayerId(res.pid);
    setRoomCode(res.code);
    saveSession(res.code, res.pid, name);
    setScreen('lobby');
  };
  const joinRoom = async (code) => {
    setBusy(true);
    const res = await emit('joinRoom', { name, code });
    setBusy(false);
    if (!res.ok) return toast(ERRORS[res.error] || res.error);
    setPlayerId(res.pid);
    setRoomCode(res.code);
    saveSession(res.code, res.pid, name);
    setScreen('lobby');
  };
  const updateConfig = (cfg) => emit('updateConfig', cfg);
  const startMatch = async () => {
    const res = await emit('startMatch', {});
    if (!res.ok) toast(ERRORS[res.error] || res.error);
  };
  const sendIntent = async (intent) => {
    const res = await emit('intent', intent);
    if (!res.ok) toast(ERRORS[res.error] || res.error);
  };
  const leave = () => {
    emit('leaveRoom', {});
    resetToHub();
  };

  // ---- render ----
  let content = null;
  if (screen === 'landing') content = <Landing onPlay={goPlay} onMakeAccount={() => setScreen('name')} name={name} />;
  else if (screen === 'name') content = <NameScreen initialName={name} onSubmit={submitName} onBack={() => setScreen('landing')} />;
  else if (screen === 'hub') content = <Hub onPick={(id) => { setGameType(id); setScreen('entry'); }} onLocked={(t) => setGag({ title: t, msg: randomGag() })} />;
  else if (screen === 'entry') content = <RoomEntry onCreate={createRoom} onJoin={joinRoom} onBack={() => setScreen('hub')} busy={busy} gameType={gameType} />;
  else if (screen === 'lobby' && room) content = <Lobby room={room} playerId={playerId} onUpdateConfig={updateConfig} onStart={startMatch} onLeave={leave} />;
  else if (screen === 'game' && view) content = <GameBoard view={view} playerId={playerId} onIntent={sendIntent} onLeave={leave} />;
  else content = <Landing onPlay={goPlay} onMakeAccount={() => setScreen('name')} name={name} />;

  const showTopbar = screen === 'hub' || screen === 'entry' || screen === 'lobby';
  const showBg = screen !== 'game'; // arcade backdrop on every menu screen, not in-game

  return (
    <>
      {showBg && (
        <div className="bg-fx" aria-hidden="true">
          <div className="bg-aurora">
            <span className="blob b1" />
            <span className="blob b2" />
            <span className="blob b3" />
            <span className="blob b4" />
          </div>
          <div className="stars" />
          <div className="stars stars2" />
          <div className="bg-grid" />
        </div>
      )}
      {reconnecting && (
        <div className="reconnect-banner">
          <span className="spin" /> Reconnecting…
        </div>
      )}
      {showTopbar && (
        <div className="topbar">
          <span className="logo">ADAMAS</span>
          {(screen === 'entry' || screen === 'lobby') && <span className="muted">{gameType === 'flip' ? 'UNO Flip' : gameType === 'spin' ? 'UNO Spin' : 'UNO No Mercy'}</span>}
          <div className="spacer" />
          {name && <span className="pill">▦ {name}</span>}
        </div>
      )}
      {content}
      {gag && (
        <div className="overlay gag-overlay" onClick={() => setGag(null)}>
          <div className="gag-card" onClick={(e) => e.stopPropagation()}>
            <button className="gag-close" onClick={() => setGag(null)} aria-label="Close">×</button>
            <div className="gag-emoji">🚧</div>
            <h3 className="gag-title">{gag.title} — Coming Soon™</h3>
            <p className="gag-msg">{gag.msg}</p>
            <button className="btn primary" onClick={() => setGag(null)}>Fine, I’ll wait 😤</button>
            <div className="gag-sparks"><span /><span /><span /><span /><span /><span /></div>
          </div>
        </div>
      )}
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'info' ? 'info' : t.kind === 'good' ? 'good' : ''}`}>{t.msg}</div>)}
      </div>
    </>
  );
}
// EOF page.js
