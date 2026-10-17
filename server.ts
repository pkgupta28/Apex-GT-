import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type CarPaintId =
  | 'SOLAR_AMBER'
  | 'CRIMSON_CORSA'
  | 'ELECTRIC_CYAN'
  | 'TITANIUM_SILVER'
  | 'EMERALD_GT';

type EnvironmentId = 'SUNSET_CANYON' | 'NIGHT_METROPOLIS' | 'ALPINE_CIRCUIT';
type RoomStatus = 'LOBBY' | 'COUNTDOWN' | 'RACING';

interface ServerPlayer {
  id: string;
  ws: WebSocket;
  roomId: string;
  name: string;
  paintId: CarPaintId;
  isReady: boolean;
  x: number;
  distanceMeters: number;
  speedMps: number;
  steerAngle: number;
  driftAngle: number;
  isBoosting: boolean;
  isDrifting: boolean;
  lap: number;
  score: number;
  shield: number;
  finished: boolean;
  finishTimeMs: number | null;
  rank: number;
  lastUpdated: number;
}

interface RaceRoom {
  roomId: string;
  environmentId: EnvironmentId;
  status: RoomStatus;
  countdownEndsAt: number | null;
  players: Map<string, ServerPlayer>;
}

const rooms = new Map<string, RaceRoom>();

function getOrCreateRoom(roomId: string): RaceRoom {
  const cleanId = (roomId || 'GLOBAL').trim().toUpperCase().slice(0, 12) || 'GLOBAL';
  let room = rooms.get(cleanId);
  if (!room) {
    room = {
      roomId: cleanId,
      environmentId: 'SUNSET_CANYON',
      status: 'LOBBY',
      countdownEndsAt: null,
      players: new Map(),
    };
    rooms.set(cleanId, room);
  }
  return room;
}

function computeRoomRankings(room: RaceRoom): void {
  const list = Array.from(room.players.values());
  list.sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTimeMs ?? 999999) - (b.finishTimeMs ?? 999999);
    }
    if (a.finished !== b.finished) {
      return a.finished ? -1 : 1;
    }
    return b.distanceMeters - a.distanceMeters;
  });
  list.forEach((p, idx) => {
    p.rank = idx + 1;
  });
}

function serializeRoom(room: RaceRoom) {
  computeRoomRankings(room);
  const now = Date.now();
  const countdownSeconds =
    room.status === 'COUNTDOWN' && room.countdownEndsAt
      ? Math.max(0, Math.ceil((room.countdownEndsAt - now) / 1000))
      : 0;

  return {
    roomId: room.roomId,
    environmentId: room.environmentId,
    status: room.status,
    countdownSeconds,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      paintId: p.paintId,
      isReady: p.isReady,
      x: p.x,
      distanceMeters: p.distanceMeters,
      speedMps: p.speedMps,
      steerAngle: p.steerAngle,
      driftAngle: p.driftAngle,
      isBoosting: p.isBoosting,
      isDrifting: p.isDrifting,
      lap: p.lap,
      score: p.score,
      shield: p.shield,
      finished: p.finished,
      finishTimeMs: p.finishTimeMs,
      rank: p.rank,
      lastUpdated: p.lastUpdated,
    })),
  };
}

function broadcastToRoom(room: RaceRoom, payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  app.use(express.json());

  // Active multiplayer rooms summary API
  app.get('/api/rooms', (_req, res) => {
    const summary = Array.from(rooms.values())
      .filter((r) => r.players.size > 0)
      .map((r) => ({
        roomId: r.roomId,
        environmentId: r.environmentId,
        status: r.status,
        playerCount: r.players.size,
      }));
    res.json({ rooms: summary });
  });

  // WebSocket Server mounted on /ws-race
  const wss = new WebSocketServer({ server, path: '/ws-race' });

  wss.on('connection', (ws: WebSocket) => {
    const playerId = `drv_${Math.random().toString(36).slice(2, 9)}`;
    let currentPlayer: ServerPlayer | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'room:join') {
          // Remove from previous room if switching rooms
          if (currentPlayer) {
            const prevRoom = rooms.get(currentPlayer.roomId);
            if (prevRoom) {
              prevRoom.players.delete(currentPlayer.id);
              if (prevRoom.players.size === 0) {
                rooms.delete(prevRoom.roomId);
              } else {
                broadcastToRoom(prevRoom, {
                  type: 'room:snapshot',
                  room: serializeRoom(prevRoom),
                });
              }
            }
          }

          const targetRoom = getOrCreateRoom(msg.roomId || 'GLOBAL');
          const slotIndex = targetRoom.players.size % 4;
          const laneX = [-5.25, -1.75, 1.75, 5.25][slotIndex];

          currentPlayer = {
            id: playerId,
            ws,
            roomId: targetRoom.roomId,
            name: String(msg.name || `RACER-${playerId.slice(-3).toUpperCase()}`).slice(0, 16),
            paintId: msg.paintId || 'SOLAR_AMBER',
            isReady: true,
            x: laneX,
            distanceMeters: 0,
            speedMps: 0,
            steerAngle: 0,
            driftAngle: 0,
            isBoosting: false,
            isDrifting: false,
            lap: 1,
            score: 0,
            shield: 100,
            finished: false,
            finishTimeMs: null,
            rank: targetRoom.players.size + 1,
            lastUpdated: Date.now(),
          };

          targetRoom.players.set(playerId, currentPlayer);

          // Send direct confirmation with assigned playerId + full snapshot
          ws.send(
            JSON.stringify({
              type: 'room:joined',
              playerId,
              room: serializeRoom(targetRoom),
            })
          );

          // Broadcast updated roster to everyone in the room
          broadcastToRoom(targetRoom, {
            type: 'room:snapshot',
            room: serializeRoom(targetRoom),
          });
          broadcastToRoom(targetRoom, {
            type: 'race:event',
            banner: `${currentPlayer.name} JOINED GRID (${targetRoom.players.size} ONLINE)`,
          });
          return;
        }

        if (!currentPlayer) return;
        const room = rooms.get(currentPlayer.roomId);
        if (!room) return;

        if (msg.type === 'player:update_profile') {
          if (typeof msg.name === 'string' && msg.name.trim()) {
            currentPlayer.name = msg.name.trim().slice(0, 16);
          }
          if (typeof msg.paintId === 'string') {
            currentPlayer.paintId = msg.paintId as CarPaintId;
          }
          if (typeof msg.isReady === 'boolean') {
            currentPlayer.isReady = msg.isReady;
          }
          if (typeof msg.environmentId === 'string') {
            room.environmentId = msg.environmentId as EnvironmentId;
          }
          currentPlayer.lastUpdated = Date.now();
          broadcastToRoom(room, {
            type: 'room:snapshot',
            room: serializeRoom(room),
          });
          return;
        }

        if (msg.type === 'race:request_start') {
          // Reset all players in room for synchronized start
          let idx = 0;
          for (const p of room.players.values()) {
            const laneX = [-5.25, -1.75, 1.75, 5.25][idx % 4];
            p.x = laneX;
            p.distanceMeters = 0;
            p.speedMps = 28;
            p.steerAngle = 0;
            p.driftAngle = 0;
            p.isBoosting = false;
            p.isDrifting = false;
            p.lap = 1;
            p.score = 0;
            p.shield = 100;
            p.finished = false;
            p.finishTimeMs = null;
            p.lastUpdated = Date.now();
            idx++;
          }
          room.status = 'COUNTDOWN';
          room.countdownEndsAt = Date.now() + 3000;
          broadcastToRoom(room, {
            type: 'race:countdown_started',
            room: serializeRoom(room),
          });
          return;
        }

        if (msg.type === 'player:telemetry') {
          currentPlayer.x = Number(msg.x) || 0;
          currentPlayer.distanceMeters = Math.max(0, Number(msg.distanceMeters) || 0);
          currentPlayer.speedMps = Math.max(0, Number(msg.speedMps) || 0);
          currentPlayer.steerAngle = Number(msg.steerAngle) || 0;
          currentPlayer.driftAngle = Number(msg.driftAngle) || 0;
          currentPlayer.isBoosting = Boolean(msg.isBoosting);
          currentPlayer.isDrifting = Boolean(msg.isDrifting);
          currentPlayer.lap = Math.max(1, Number(msg.lap) || 1);
          currentPlayer.score = Math.max(0, Number(msg.score) || 0);
          currentPlayer.shield = Math.max(0, Math.min(100, Number(msg.shield) ?? 100));

          if (msg.finished && !currentPlayer.finished) {
            currentPlayer.finished = true;
            currentPlayer.finishTimeMs = Number(msg.finishTimeMs) || 0;
            computeRoomRankings(room);
            broadcastToRoom(room, {
              type: 'race:event',
              banner: `${currentPlayer.name} FINISHED P${currentPlayer.rank}!`,
            });
          }
          currentPlayer.lastUpdated = Date.now();
          return;
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      if (!currentPlayer) return;
      const room = rooms.get(currentPlayer.roomId);
      if (room) {
        const leftName = currentPlayer.name;
        room.players.delete(currentPlayer.id);
        if (room.players.size === 0) {
          rooms.delete(room.roomId);
        } else {
          broadcastToRoom(room, {
            type: 'room:snapshot',
            room: serializeRoom(room),
          });
          broadcastToRoom(room, {
            type: 'race:event',
            banner: `${leftName} LEFT THE CIRCUIT`,
          });
        }
      }
    });
  });

  // Authoritative 20Hz Server Tick for Countdown Transitions & Real-Time Telemetry Broadcasts
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.players.size === 0) continue;

      if (room.status === 'COUNTDOWN' && room.countdownEndsAt && now >= room.countdownEndsAt) {
        room.status = 'RACING';
        room.countdownEndsAt = null;
        broadcastToRoom(room, {
          type: 'race:started',
          room: serializeRoom(room),
        });
        continue;
      }

      broadcastToRoom(room, {
        type: 'room:snapshot',
        room: serializeRoom(room),
      });
    }
  }, 50);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex GT Multiplayer Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
