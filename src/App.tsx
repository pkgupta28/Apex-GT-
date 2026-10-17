import React, { useEffect, useRef, useState } from 'react';
import {
  CameraMode,
  CAR_PAINT_PRESETS,
  CarPaintId,
  ENVIRONMENT_PRESETS,
  EnvironmentId,
  GameState,
  OnlinePlayerState,
  RoomStateSnapshot,
  TelemetryData,
} from './types/game';
import { RacingSceneController } from './three/RacingSceneController';
import { soundEngine } from './audio/soundEngine';
import { MultiplayerClient } from './network/multiplayerClient';

const INITIAL_TELEMETRY: TelemetryData = {
  speedKmh: 158,
  rpm: 3800,
  gear: 3,
  nitro: 100,
  isBoosting: false,
  isDrifting: false,
  shield: 100,
  score: 0,
  combo: 1,
  nearMisses: 0,
  lap: 1,
  totalLaps: 3,
  lapTimeMs: 0,
  bestLapTimeMs: null,
  totalTimeMs: 0,
  distanceMeters: 0,
  lapProgress: 0,
  positionRank: 1,
  totalRacers: 8,
  eventBanner: null,
};

function formatRaceTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    hundredths
  ).padStart(2, '0')}`;
}

function getInitialRoomFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  return room ? room.trim().toUpperCase().slice(0, 12) : 'GLOBAL';
}

function getStoredCallsign(): string {
  try {
    const saved = localStorage.getItem('apex_gt_callsign');
    if (saved && saved.trim()) return saved.trim().slice(0, 14);
  } catch {
    // ignore storage errors
  }
  const randomDigits = Math.floor(100 + Math.random() * 900);
  return `APEX-${randomDigits}`;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<RacingSceneController | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.TITLE);
  const [telemetry, setTelemetry] = useState<TelemetryData>(INITIAL_TELEMETRY);
  const [cameraMode, setCameraMode] = useState<CameraMode>(CameraMode.CHASE);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>(EnvironmentId.SUNSET_CANYON);
  const [paintId, setPaintId] = useState<CarPaintId>(CarPaintId.SOLAR_AMBER);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [webglLost, setWebglLost] = useState<boolean>(false);

  // Online Multiplayer State
  const [isOnlineConnected, setIsOnlineConnected] = useState<boolean>(false);
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState<string>(getStoredCallsign);
  const [roomIdInput, setRoomIdInput] = useState<string>(getInitialRoomFromUrl);
  const [roomSnapshot, setRoomSnapshot] = useState<RoomStateSnapshot | null>(null);
  const [copiedInvite, setCopiedInvite] = useState<boolean>(false);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const controller = new RacingSceneController(mountEl, {
      onTelemetryUpdate: (data) => setTelemetry(data),
      onNetworkTick: (payload, force) => {
        mpClientRef.current?.sendTelemetry(payload, force);
      },
      onGameStateChange: (state) => setGameState(state),
      onCameraModeChange: (mode) => setCameraMode(mode),
      onHudToggleRequest: () => setIsDockCollapsed((prev) => !prev),
    });
    controllerRef.current = controller;

    // Initialize Real-Time WebSocket Multiplayer Client
    const mpClient = new MultiplayerClient(roomIdInput, driverName, paintId, {
      onConnectionStatus: (connected) => setIsOnlineConnected(connected),
      onRoomUpdate: (room, myId) => {
        setRoomSnapshot(room);
        setLocalPlayerId(myId);
        controller.syncRemotePlayers(room.players, myId);
        setEnvironmentId((prevEnv) => {
          if (prevEnv !== room.environmentId) {
            controller.applyEnvironmentPreset(room.environmentId);
            return room.environmentId;
          }
          return prevEnv;
        });
      },
      onRaceTransition: (type, room) => {
        const myId = mpClient.getLocalPlayerId();
        const me = room.players.find((p) => p.id === myId);
        if (type === 'COUNTDOWN') {
          soundEngine.playCheckpoint(false);
          controller.prepareCountdownGrid(me?.x);
        } else if (type === 'START') {
          soundEngine.playCheckpoint(true);
          controller.startNewRace();
        }
      },
      onEventBanner: (banner) => {
        controller.showBannerMessage(banner, 2.4);
      },
    });
    mpClientRef.current = mpClient;

    const canvas = mountEl.querySelector('canvas');
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => {
      setWebglLost(false);
    };

    if (canvas) {
      canvas.addEventListener('webglcontextlost', handleContextLost);
      canvas.addEventListener('webglcontextrestored', handleContextRestored);
    }

    return () => {
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      }
      mpClient.dispose();
      mpClientRef.current = null;
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const handleDriverNameChange = (newName: string) => {
    const clean = newName.slice(0, 14);
    setDriverName(clean);
    try {
      localStorage.setItem('apex_gt_callsign', clean);
    } catch {
      // ignore
    }
    mpClientRef.current?.updateProfile({ name: clean || 'RACER' });
  };

  const handleJoinRoom = (targetRoomId: string) => {
    const cleanRoom = (targetRoomId || 'GLOBAL').trim().toUpperCase().slice(0, 12) || 'GLOBAL';
    setRoomIdInput(cleanRoom);
    const url = new URL(window.location.href);
    if (cleanRoom === 'GLOBAL') {
      url.searchParams.delete('room');
    } else {
      url.searchParams.set('room', cleanRoom);
    }
    window.history.replaceState({}, '', url.toString());
    mpClientRef.current?.sendJoinRoom(cleanRoom, driverName, paintId);
  };

  const handleCreatePrivateRoom = () => {
    const code = `GP-${Math.floor(100 + Math.random() * 900)}`;
    handleJoinRoom(code);
  };

  const handleCopyInviteLink = () => {
    const activeRoom = roomSnapshot?.roomId || roomIdInput || 'GLOBAL';
    const url = new URL(window.location.href);
    url.searchParams.set('room', activeRoom);
    navigator.clipboard?.writeText(url.toString()).catch(() => {});
    setCopiedInvite(true);
    window.setTimeout(() => setCopiedInvite(false), 2000);
  };

  const handleStartMultiplayerCountdown = () => {
    soundEngine.init();
    if (isOnlineConnected && (roomSnapshot?.players.length ?? 0) >= 1) {
      mpClientRef.current?.requestSynchronizedStart();
    } else {
      controllerRef.current?.startNewRace();
    }
  };

  const handleStartSoloOrImmediate = () => {
    soundEngine.init();
    controllerRef.current?.startNewRace();
  };

  const handleResumeRace = () => {
    controllerRef.current?.setGameState(GameState.PLAYING);
  };

  const handlePauseToggle = () => {
    if (gameState === GameState.PLAYING) {
      controllerRef.current?.setGameState(GameState.PAUSED);
    } else if (gameState === GameState.PAUSED) {
      controllerRef.current?.setGameState(GameState.PLAYING);
    }
  };

  const handleReturnToTitle = () => {
    controllerRef.current?.setGameState(GameState.TITLE);
  };

  const handleSelectPaint = (id: CarPaintId) => {
    setPaintId(id);
    controllerRef.current?.setCarPaint(id);
    mpClientRef.current?.updateProfile({ paintId: id });
  };

  const handleSelectEnvironment = (id: EnvironmentId) => {
    setEnvironmentId(id);
    controllerRef.current?.applyEnvironmentPreset(id);
    mpClientRef.current?.updateProfile({ environmentId: id });
  };

  const handleSelectCamera = (mode: CameraMode) => {
    setCameraMode(mode);
    controllerRef.current?.setCameraMode(mode);
  };

  const handleToggleMute = () => {
    soundEngine.init();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    soundEngine.setMuted(nextMuted);
  };

  const rpmPercent = Math.min(100, Math.max(0, ((telemetry.rpm - 1000) / 8000) * 100));
  const currentEnvPreset = ENVIRONMENT_PRESETS[environmentId];
  const onlinePlayers: OnlinePlayerState[] = roomSnapshot?.players || [];
  const activeRoomCode = roomSnapshot?.roomId || roomIdInput || 'GLOBAL';

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07090E] select-none">
      {/* Isolated WebGL Canvas Container */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* WebGL Context Lost Fallback Safety */}
      {webglLost && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#07090E] p-6 text-center">
          <p className="font-display text-2xl font-bold text-amber-400">
            3D Graphics Context Suspended
          </p>
          <p className="mt-2 text-sm text-slate-400 max-w-md">
            Your browser paused the WebGL hardware surface. Click below to restore the circuit.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 px-5 py-2.5 bg-amber-500 text-slate-950 font-semibold text-sm rounded-lg hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Restore Viewport
          </button>
        </div>
      )}

      {/* =====================================================================
          1. TITLE SCREEN & ONLINE MULTIPLAYER LOBBY OVERLAY
         ===================================================================== */}
      {gameState === GameState.TITLE && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-5 md:p-8 bg-gradient-to-t from-[#07090E]/92 via-transparent to-[#07090E]/80">
          {/* Top Perimeter Bar: Circuit Spec, Online Connection Telemetry & Audio Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300 font-medium">
              <span className="text-amber-400 font-semibold">{currentEnvPreset.name}</span>
              <span aria-hidden="true">·</span>
              <span>{currentEnvPreset.subtitle}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-cyan-300">
                {isOnlineConnected
                  ? `Room ${activeRoomCode} (${onlinePlayers.length} Online)`
                  : 'Connecting to Lobby...'}
              </span>
            </div>

            <div className="pointer-events-auto flex items-center gap-2.5">
              <button
                onClick={handleCopyInviteLink}
                className="px-3.5 py-2 rounded-lg bg-[#0D111A]/90 border border-white/10 text-xs font-medium text-cyan-300 hover:border-cyan-400/50 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedInvite ? 'Invite Link Copied!' : `Invite Link (Room ${activeRoomCode})`}
              </button>

              <button
                onClick={handleToggleMute}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#0D111A]/90 border border-white/10 text-xs font-medium text-slate-200 hover:border-amber-400/50 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isMuted ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                  )}
                </svg>
                <span>{isMuted ? 'Audio Muted' : 'Synth Audio On'}</span>
              </button>
            </div>
          </div>

          {/* Main Split: Left Title Lockup & Controls | Bottom-Right Online Grid Roster */}
          <div className="my-auto flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            {/* Left Column: Bespoke SVG Lockup, Garage Customization & Launch CTA */}
            <div className="max-w-xl pointer-events-auto">
              <svg
                viewBox="0 0 520 118"
                className="w-full max-w-[430px] h-auto drop-shadow-[0_10px_24px_rgba(0,0,0,0.85)]"
                role="img"
                aria-label="Apex GT Circuit Overdrive"
              >
                <defs>
                  <linearGradient id="apexTitleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="55%" stopColor="#F8FAFC" />
                    <stop offset="100%" stopColor="#38BDF8" />
                  </linearGradient>
                </defs>
                <path d="M4 18 H145 L133 24 H4 Z" fill="#F59E0B" />
                <path d="M158 18 H220 L214 24 H152 Z" fill="#06B6D4" />
                <text
                  x="2"
                  y="78"
                  fill="url(#apexTitleGrad)"
                  fontFamily="Chakra Petch, sans-serif"
                  fontWeight="700"
                  fontStyle="italic"
                  fontSize="68"
                  letterSpacing="2"
                >
                  APEX GT
                </text>
                <text
                  x="6"
                  y="108"
                  fill="#E2E8F0"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                  fontWeight="600"
                  fontSize="16"
                  letterSpacing="7.5"
                >
                  ONLINE MULTIPLAYER CIRCUIT
                </text>
              </svg>

              <p className="mt-2.5 text-sm text-slate-300 max-w-md leading-relaxed">
                Race live against drivers across devices in real time. Share your room code or invite
                link, draft behind online rivals for slipstream boost, and claim P1.
              </p>

              {/* Driver Callsign & Room Code Controls */}
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Driver Callsign
                  </label>
                  <input
                    type="text"
                    value={driverName}
                    onChange={(e) => handleDriverNameChange(e.target.value)}
                    placeholder="APEX-101"
                    maxLength={14}
                    className="w-36 px-3 py-2 rounded-lg bg-[#0D111A]/95 border border-white/15 text-xs font-semibold text-white focus:outline-none focus:border-amber-400 font-mono-tabular uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Multiplayer Room Code
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={roomIdInput}
                      onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleJoinRoom(roomIdInput);
                      }}
                      placeholder="GLOBAL"
                      maxLength={12}
                      className="w-28 px-3 py-2 rounded-lg bg-[#0D111A]/95 border border-white/15 text-xs font-semibold text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono-tabular uppercase"
                    />
                    <button
                      onClick={() => handleJoinRoom(roomIdInput)}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Join Room
                    </button>
                    <button
                      onClick={handleCreatePrivateRoom}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      New Room
                    </button>
                    {activeRoomCode !== 'GLOBAL' && (
                      <button
                        onClick={() => handleJoinRoom('GLOBAL')}
                        className="px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Global
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Track & Livery Selectors */}
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-1.5">Track Environment</div>
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0D111A]/90 border border-white/10">
                    {Object.values(ENVIRONMENT_PRESETS).map((env) => (
                      <button
                        key={env.id}
                        onClick={() => handleSelectEnvironment(env.id)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          environmentId === env.id
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {env.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-slate-400 mb-1.5">Clearcoat Livery</div>
                  <div className="flex items-center gap-2 p-1.5 rounded-lg bg-[#0D111A]/90 border border-white/10">
                    {CAR_PAINT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleSelectPaint(preset.id)}
                        title={preset.name}
                        aria-label={preset.name}
                        className={`w-6 h-6 rounded-md transition-transform cursor-pointer shrink-0 ${
                          paintId === preset.id
                            ? 'ring-2 ring-white scale-110'
                            : 'opacity-75 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: preset.hex }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Primary Start CTAs */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleStartMultiplayerCountdown}
                  className="px-6 py-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-display font-bold text-base tracking-wide transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-[0_0_28px_rgba(245,158,11,0.35)]"
                >
                  {onlinePlayers.length > 1
                    ? `Start Synchronized Race (${onlinePlayers.length} Drivers)`
                    : 'Start Grand Prix'}
                </button>

                {roomSnapshot?.status === 'RACING' && (
                  <button
                    onClick={handleStartSoloOrImmediate}
                    className="px-4 py-3.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Join Active Race Now
                  </button>
                )}
              </div>
            </div>

            {/* Right Column: Live Online Room Drivers Roster */}
            <div className="w-full lg:w-80 pointer-events-auto rounded-xl bg-[#090D16]/90 border border-white/12 p-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <span className="text-xs font-semibold text-white">
                  Live Grid · Room {activeRoomCode}
                </span>
                <span className="text-xs font-mono-tabular text-cyan-400">
                  {onlinePlayers.length} {onlinePlayers.length === 1 ? 'Driver' : 'Drivers'}
                </span>
              </div>

              <div className="mt-2.5 space-y-2 max-h-40 overflow-y-auto pr-1">
                {onlinePlayers.length === 0 ? (
                  <div className="text-xs text-slate-400 py-2">
                    Syncing room state...
                  </div>
                ) : (
                  onlinePlayers.map((p) => {
                    const preset =
                      CAR_PAINT_PRESETS.find((c) => c.id === p.paintId) || CAR_PAINT_PRESETS[0];
                    const isMe = p.id === localPlayerId;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg bg-slate-900/80"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: preset.hex }}
                          />
                          <span className="font-semibold text-white truncate">
                            {p.name}
                          </span>
                          {isMe && (
                            <span className="text-[11px] text-amber-400 font-medium shrink-0">
                              (You)
                            </span>
                          )}
                        </div>
                        <span className="font-mono-tabular text-slate-400 shrink-0">
                          {p.distanceMeters > 0 ? `${p.distanceMeters}m` : 'On Grid'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-3 pt-2.5 border-t border-white/10 text-[11px] text-slate-400 leading-snug">
                Open this URL or share <span className="text-slate-200 font-mono-tabular">Room {activeRoomCode}</span> on any other device to race head-to-head.
              </div>
            </div>
          </div>

          {/* Single Flat Control-Hint Line */}
          <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span>
              WASD / Arrows Steer &amp; Throttle · Shift Nitro Boost · Space Drift · C Camera · Esc Pause
            </span>
            <span className="text-slate-400 font-mono-tabular">
              Draft behind online racers for slipstream nitro recharge
            </span>
          </div>
        </div>
      )}

      {/* =====================================================================
          1B. SYNCHRONIZED MULTIPLAYER STARTING GRID COUNTDOWN OVERLAY
         ===================================================================== */}
      {gameState === GameState.COUNTDOWN && (
        <div className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center bg-[#07090E]/45">
          <div className="px-8 py-6 rounded-2xl bg-[#090D16]/92 border border-amber-400/40 text-center">
            <div className="text-xs font-semibold text-slate-300 tracking-wider uppercase">
              Room {activeRoomCode} · Synchronized Grid Launch
            </div>
            <div className="mt-2 font-display text-7xl font-bold text-amber-400 font-mono-tabular">
              {roomSnapshot?.countdownSeconds && roomSnapshot.countdownSeconds > 0
                ? roomSnapshot.countdownSeconds
                : 'GO!'}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Hold W / Up Arrow for launch rpm
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. ACTIVE RACING HUD (World-Matched Perimeter Clusters + Bottom Dock)
         ===================================================================== */}
      {gameState !== GameState.TITLE && gameState !== GameState.COUNTDOWN && (
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 md:p-6">
          {/* Top Perimeter Row */}
          <div className="flex items-start justify-between gap-4">
            {/* Top-Left Perimeter Cluster: Position, Lap, Score, Online Standings */}
            <div className="flex flex-col gap-2">
              <div className="pointer-events-auto flex items-center gap-5 px-4 py-2.5 rounded-xl bg-[#090D16]/90 border border-white/10">
                <div>
                  <div className="text-[11px] text-slate-400 font-medium">Position</div>
                  <div className="font-display text-2xl font-bold text-amber-400 font-mono-tabular leading-tight">
                    P{telemetry.positionRank}
                    <span className="text-sm text-slate-400 font-normal">/{telemetry.totalRacers}</span>
                  </div>
                </div>

                <div className="h-7 w-px bg-white/10" />

                <div>
                  <div className="text-[11px] text-slate-400 font-medium">Lap</div>
                  <div className="font-display text-2xl font-bold text-white font-mono-tabular leading-tight">
                    {telemetry.lap}
                    <span className="text-sm text-slate-400 font-normal">/{telemetry.totalLaps}</span>
                  </div>
                </div>

                <div className="h-7 w-px bg-white/10" />

                <div>
                  <div className="text-[11px] text-slate-400 font-medium">Score</div>
                  <div className="font-display text-2xl font-bold text-cyan-400 font-mono-tabular leading-tight">
                    {telemetry.score.toLocaleString()}
                  </div>
                </div>

                {telemetry.combo > 1 && (
                  <>
                    <div className="h-7 w-px bg-white/10" />
                    <div>
                      <div className="text-[11px] text-amber-300 font-medium">Combo</div>
                      <div className="font-display text-2xl font-bold text-amber-400 font-mono-tabular leading-tight">
                        ×{telemetry.combo}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Compact Online Multiplayer Live Standings Strip (When >= 2 online players) */}
              {onlinePlayers.length > 1 && (
                <div className="hidden sm:flex flex-col gap-1 px-3.5 py-2 rounded-xl bg-[#090D16]/90 border border-white/10 max-w-xs">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Room {activeRoomCode} Standings</span>
                    <span className="font-mono-tabular">{onlinePlayers.length} Online</span>
                  </div>
                  {onlinePlayers.slice(0, 4).map((p) => {
                    const isMe = p.id === localPlayerId;
                    const gapMeters = p.distanceMeters - telemetry.distanceMeters;
                    const gapLabel = isMe
                      ? `${telemetry.distanceMeters}m`
                      : gapMeters >= 0
                      ? `+${gapMeters}m`
                      : `${gapMeters}m`;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between text-xs font-mono-tabular ${
                          isMe ? 'text-amber-400 font-semibold' : 'text-slate-200'
                        }`}
                      >
                        <span className="truncate max-w-[150px]">
                          P{p.rank} · {p.name}
                        </span>
                        <span>{gapLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Center Event Banner */}
            {telemetry.eventBanner && (
              <div className="hidden lg:flex items-center px-4 py-2 rounded-lg bg-[#090D16]/92 border border-amber-400/40 text-amber-300 font-display font-bold text-sm tracking-wide font-mono-tabular">
                {telemetry.eventBanner}
              </div>
            )}

            {/* Top-Right Perimeter Cluster: Lap Timer & Audio/Pause Controls */}
            <div className="pointer-events-auto flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-4 px-4 py-2.5 rounded-xl bg-[#090D16]/90 border border-white/10">
                <div>
                  <div className="text-[11px] text-slate-400 font-medium">Lap Time</div>
                  <div className="font-mono-tabular text-base font-bold text-white">
                    {formatRaceTime(telemetry.lapTimeMs)}
                  </div>
                </div>
                {telemetry.bestLapTimeMs !== null && (
                  <>
                    <div className="h-6 w-px bg-white/10" />
                    <div>
                      <div className="text-[11px] text-slate-400 font-medium">Best Lap</div>
                      <div className="font-mono-tabular text-base font-bold text-emerald-400">
                        {formatRaceTime(telemetry.bestLapTimeMs)}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={handleToggleMute}
                aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                className="p-2.5 rounded-xl bg-[#090D16]/90 border border-white/10 text-slate-200 hover:border-amber-400/50 hover:text-white transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {isMuted ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                  )}
                </svg>
              </button>

              <button
                onClick={handlePauseToggle}
                className="px-3.5 py-2.5 rounded-xl bg-[#090D16]/90 border border-white/10 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Pause (Esc)
              </button>
            </div>
          </div>

          {/* Mobile Touch Controls */}
          <div className="md:hidden flex items-center justify-between gap-4 my-auto pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onPointerDown={() => controllerRef.current?.setTouchInput({ left: true })}
                onPointerUp={() => controllerRef.current?.setTouchInput({ left: false })}
                onPointerLeave={() => controllerRef.current?.setTouchInput({ left: false })}
                className="w-14 h-14 rounded-xl bg-[#090D16]/85 border border-white/15 flex items-center justify-center text-white active:bg-amber-500 active:text-slate-950 font-bold"
              >
                ◀
              </button>
              <button
                onPointerDown={() => controllerRef.current?.setTouchInput({ right: true })}
                onPointerUp={() => controllerRef.current?.setTouchInput({ right: false })}
                onPointerLeave={() => controllerRef.current?.setTouchInput({ right: false })}
                className="w-14 h-14 rounded-xl bg-[#090D16]/85 border border-white/15 flex items-center justify-center text-white active:bg-amber-500 active:text-slate-950 font-bold"
              >
                ▶
              </button>
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onPointerDown={() => controllerRef.current?.setTouchInput({ drift: true })}
                onPointerUp={() => controllerRef.current?.setTouchInput({ drift: false })}
                onPointerLeave={() => controllerRef.current?.setTouchInput({ drift: false })}
                className="px-3.5 h-14 rounded-xl bg-[#090D16]/85 border border-amber-400/40 text-amber-300 font-bold text-xs"
              >
                DRIFT
              </button>
              <button
                onPointerDown={() => controllerRef.current?.setTouchInput({ nitro: true })}
                onPointerUp={() => controllerRef.current?.setTouchInput({ nitro: false })}
                onPointerLeave={() => controllerRef.current?.setTouchInput({ nitro: false })}
                className="px-3.5 h-14 rounded-xl bg-[#090D16]/85 border border-cyan-400/40 text-cyan-300 font-bold text-xs"
              >
                NITRO
              </button>
            </div>
          </div>

          {/* =================================================================
              UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK
             ================================================================= */}
          <div className="relative mx-auto w-full max-w-[920px] pointer-events-auto flex flex-col items-center">
            <button
              onClick={() => setIsDockCollapsed((prev) => !prev)}
              className="mb-1.5 px-3.5 py-1 rounded-lg bg-[#090D16]/90 border border-white/10 text-[11px] font-medium text-slate-300 hover:text-white hover:border-amber-400/40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isDockCollapsed ? '▴ Show Telemetry & Controls (H)' : '▾ Hide Controls (H)'}
            </button>

            <div
              className={`w-full rounded-2xl bg-[#090D16]/92 border border-white/12 px-5 py-3.5 transition-all duration-200 ${
                isDockCollapsed
                  ? 'opacity-0 translate-y-8 pointer-events-none h-0 py-0 overflow-hidden border-0'
                  : 'opacity-100 translate-y-0'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-5">
                {/* 1. Digital Speedometer, Gear & RPM Bar */}
                <div className="flex items-center gap-4 min-w-[210px]">
                  <div className="flex flex-col items-center justify-center w-11 h-11 rounded-lg bg-slate-900 border border-white/10">
                    <span className="text-[10px] text-slate-400 leading-none">GEAR</span>
                    <span className="font-display text-xl font-bold text-amber-400 font-mono-tabular leading-tight">
                      {telemetry.gear}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl font-bold text-white font-mono-tabular tracking-tight leading-none">
                        {telemetry.speedKmh}
                      </span>
                      <span className="text-xs font-semibold text-slate-400">KM/H</span>
                    </div>
                    <div className="mt-1.5 w-32 h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 via-amber-400 to-red-500 transition-transform duration-75 origin-left"
                        style={{ transform: `scaleX(${rpmPercent / 100})` }}
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Nitro Boost & Chassis Shield Integrity Bars */}
                <div className="flex items-center gap-5 flex-1 min-w-[220px] max-w-xs">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-cyan-300 font-medium">Nitro Boost</span>
                      <span className="font-mono-tabular text-slate-300">{telemetry.nitro}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-transform duration-75 origin-left"
                        style={{ transform: `scaleX(${telemetry.nitro / 100})` }}
                      />
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span
                        className={`font-medium ${
                          telemetry.shield <= 30 ? 'text-red-400' : 'text-emerald-300'
                        }`}
                      >
                        Chassis Shield
                      </span>
                      <span className="font-mono-tabular text-slate-300">{telemetry.shield}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-transform duration-100 origin-left ${
                          telemetry.shield <= 30 ? 'bg-red-500' : 'bg-emerald-400'
                        }`}
                        style={{ transform: `scaleX(${telemetry.shield / 100})` }}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Camera View, Environment & Livery Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10">
                    {(
                      [
                        { id: CameraMode.CHASE, label: 'Chase' },
                        { id: CameraMode.COCKPIT, label: 'Cockpit' },
                        { id: CameraMode.AERIAL, label: 'Aerial' },
                      ] as const
                    ).map((cam) => (
                      <button
                        key={cam.id}
                        onClick={() => handleSelectCamera(cam.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          cameraMode === cam.id
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {cam.label}
                      </button>
                    ))}
                  </div>

                  <div className="hidden sm:flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-white/10">
                    {(
                      [
                        { id: EnvironmentId.SUNSET_CANYON, label: 'Canyon' },
                        { id: EnvironmentId.NIGHT_METROPOLIS, label: 'Night' },
                        { id: EnvironmentId.ALPINE_CIRCUIT, label: 'Alpine' },
                      ] as const
                    ).map((env) => (
                      <button
                        key={env.id}
                        onClick={() => handleSelectEnvironment(env.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          environmentId === env.id
                            ? 'bg-slate-700 text-white font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {env.label}
                      </button>
                    ))}
                  </div>

                  <div className="hidden md:flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900 border border-white/10">
                    {CAR_PAINT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleSelectPaint(preset.id)}
                        title={preset.name}
                        aria-label={preset.name}
                        className={`w-4 h-4 rounded-sm transition-transform cursor-pointer shrink-0 ${
                          paintId === preset.id ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: preset.hex }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3. PAUSE / VICTORY / GAME OVER MODAL OVERLAY WITH MULTIPLAYER STANDINGS
         ===================================================================== */}
      {(gameState === GameState.PAUSED ||
        gameState === GameState.VICTORY ||
        gameState === GameState.GAME_OVER) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#07090E]/85 p-6">
          <div className="w-full max-w-md rounded-2xl bg-[#0D131F] border border-white/15 p-7 shadow-2xl">
            <h2 className="font-display text-3xl font-bold text-white tracking-tight">
              {gameState === GameState.PAUSED && 'Race Paused'}
              {gameState === GameState.VICTORY && 'Grand Prix Victory'}
              {gameState === GameState.GAME_OVER && 'Chassis Critical'}
            </h2>

            <p className="mt-1.5 text-sm text-slate-300">
              {gameState === GameState.PAUSED &&
                `Room ${activeRoomCode} · ${currentEnvPreset.name} · Lap ${telemetry.lap} of ${telemetry.totalLaps}`}
              {gameState === GameState.VICTORY &&
                `You completed all ${telemetry.totalLaps} laps of ${currentEnvPreset.name} in P${telemetry.positionRank}!`}
              {gameState === GameState.GAME_OVER &&
                'Heavy traffic impacts depleted your chassis shield before the checkered flag.'}
            </p>

            {/* Telemetry Summary Table */}
            <div className="mt-5 space-y-2 border-t border-b border-white/10 py-3.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total Score</span>
                <span className="font-mono-tabular font-bold text-amber-400">
                  {telemetry.score.toLocaleString()} PTS
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Race Time</span>
                <span className="font-mono-tabular font-semibold text-white">
                  {formatRaceTime(telemetry.totalTimeMs)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Best Lap</span>
                <span className="font-mono-tabular font-semibold text-emerald-400">
                  {telemetry.bestLapTimeMs !== null
                    ? formatRaceTime(telemetry.bestLapTimeMs)
                    : formatRaceTime(telemetry.lapTimeMs)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">High-Speed Near Misses</span>
                <span className="font-mono-tabular font-semibold text-cyan-400">
                  {telemetry.nearMisses}
                </span>
              </div>
            </div>

            {/* Online Room Leaderboard in Modal */}
            {onlinePlayers.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-slate-400 mb-2">
                  Room {activeRoomCode} Live Standings ({onlinePlayers.length} Online)
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {onlinePlayers.map((p) => {
                    const isMe = p.id === localPlayerId;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-slate-900/90 font-mono-tabular"
                      >
                        <span className={isMe ? 'text-amber-400 font-bold' : 'text-slate-200'}>
                          P{p.rank} · {p.name} {isMe ? '(You)' : ''}
                        </span>
                        <span className="text-slate-400">
                          {p.finished && p.finishTimeMs
                            ? formatRaceTime(p.finishTimeMs)
                            : `${p.distanceMeters}m`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              {gameState === GameState.PAUSED && (
                <button
                  onClick={handleResumeRace}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Resume Race
                </button>
              )}

              <button
                onClick={handleStartMultiplayerCountdown}
                className={`flex-1 py-2.5 px-4 rounded-lg font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  gameState === GameState.PAUSED
                    ? 'bg-slate-800 hover:bg-slate-700 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {gameState === GameState.PAUSED ? 'Restart Room Race' : 'Race Again'}
              </button>

              <button
                onClick={handleReturnToTitle}
                className="py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
