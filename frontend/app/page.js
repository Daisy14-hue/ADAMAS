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
};

export default function Home() {
  const [name, setName] = useState('');
  const [screen, setScreen] = useState('landing'); // landing|name|hub|entry|lobby|game
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [view, setView] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const afterName = useRef(null);

  const toast = (msg, kind = 'err') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };

  // socket lifecycle
  useEffect(() => {
    const s = getSocket();
    setPlayerId(s.id || null);
    const onConnect = () => setPlayerId(s.id);
    const onLobby = (data) => setRoom(data);
    const onState = ({ view: v }) => { setView(v); setScreen('game'); };
    const onEnded = ({ reason }) => {
      toast(reason === 'PLAYER_DISCONNECTED' ? 'A player disconnected — match ended.' : 'Match ended.', 'info');
    };
    s.on('connect', onConnect);
    s.on('lobby', onLobby);
    s.on('state', onState);
    s.on('ended', onEnded);
    return () => {
      s.off('connect', onConnect);
      s.off('lobby', onLobby);
      s.off('state', onState);
      s.off('ended', onEnded);
    };
  }, []);

  // ---- actions ----
  const goPlay = () => {
    if (name) setScreen('hub');
    else { afterName.current = 'hub'; setScreen('name'); }
  };
  const submitName = (n) => {
    setName(n);
    const next = afterName.current || 'hub';
    afterName.current = null;
    setScreen(next);
  };

  const createRoom = async () => {
    setBusy(true);
    const res = await emit('createRoom', { name });
    setBusy(false);
    if (!res.ok) return toast(ERRORS[res.error] || res.error);
    setPlayerId(res.playerId);
    setScreen('lobby');
  };
  const joinRoom = async (code) => {
    setBusy(true);
    const res = await emit('joinRoom', { name, code });
    setBusy(false);
    if (!res.ok) return toast(ERRORS[res.error] || res.error);
    setPlayerId(res.playerId);
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
    setRoom(null);
    setView(null);
    setScreen('hub');
  };

  // ---- render ----
  let content = null;
  if (screen === 'landing') content = <Landing onPlay={goPlay} onMakeAccount={() => setScreen('name')} name={name} />;
  else if (screen === 'name') content = <NameScreen initialName={name} onSubmit={submitName} onBack={() => setScreen('landing')} />;
  else if (screen === 'hub') content = <Hub onPickNoMercy={() => setScreen('entry')} onLocked={(t) => toast(`${t} is coming soon.`, 'info')} />;
  else if (screen === 'entry') content = <RoomEntry onCreate={createRoom} onJoin={joinRoom} onBack={() => setScreen('hub')} busy={busy} />;
  else if (screen === 'lobby' && room) content = <Lobby room={room} playerId={playerId} onUpdateConfig={updateConfig} onStart={startMatch} onLeave={leave} />;
  else if (screen === 'game' && view) content = <GameBoard view={view} playerId={playerId} onIntent={sendIntent} onLeave={leave} />;
  else content = <Landing onPlay={goPlay} onMakeAccount={() => setScreen('name')} name={name} />;

  const showTopbar = screen === 'hub' || screen === 'entry' || screen === 'lobby';

  return (
    <>
      {showTopbar && (
        <div className="topbar">
          <span className="logo">ADAMAS</span>
          <span className="muted">UNO No Mercy</span>
          <div className="spacer" />
          {name && <span className="pill">▦ {name}</span>}
        </div>
      )}
      {content}
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'info' ? 'info' : t.kind === 'good' ? 'good' : ''}`}>{t.msg}</div>)}
      </div>
    </>
  );
}
// EOF page.js
