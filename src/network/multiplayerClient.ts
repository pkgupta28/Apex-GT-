import {
  CarPaintId,
  EnvironmentId,
  RoomStateSnapshot,
} from '../types/game';

type RoomUpdateCallback = (room: RoomStateSnapshot, localPlayerId: string | null) => void;
type RaceTransitionCallback = (type: 'COUNTDOWN' | 'START', room: RoomStateSnapshot) => void;
type EventBannerCallback = (banner: string) => void;
type ConnectionStatusCallback = (connected: boolean) => void;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private isDisposed = false;

  private localPlayerId: string | null = null;
  private currentRoomId: string;
  private driverName: string;
  private paintId: CarPaintId;
  private latestRoom: RoomStateSnapshot | null = null;
  private lastTelemetrySentAt = 0;

  private onRoomUpdate?: RoomUpdateCallback;
  private onRaceTransition?: RaceTransitionCallback;
  private onEventBanner?: EventBannerCallback;
  private onConnectionStatus?: ConnectionStatusCallback;

  constructor(
    initialRoomId: string,
    driverName: string,
    paintId: CarPaintId,
    callbacks: {
      onRoomUpdate?: RoomUpdateCallback;
      onRaceTransition?: RaceTransitionCallback;
      onEventBanner?: EventBannerCallback;
      onConnectionStatus?: ConnectionStatusCallback;
    }
  ) {
    this.currentRoomId = initialRoomId;
    this.driverName = driverName;
    this.paintId = paintId;
    this.onRoomUpdate = callbacks.onRoomUpdate;
    this.onRaceTransition = callbacks.onRaceTransition;
    this.onEventBanner = callbacks.onEventBanner;
    this.onConnectionStatus = callbacks.onConnectionStatus;

    this.connect();
  }

  private connect(): void {
    if (this.isDisposed) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws-race`;

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.isDisposed) return;
        this.onConnectionStatus?.(true);
        this.sendJoinRoom(this.currentRoomId, this.driverName, this.paintId);
      };

      ws.onmessage = (event) => {
        if (this.isDisposed) return;
        try {
          const msg = JSON.parse(String(event.data));
          if (!msg || typeof msg.type !== 'string') return;

          if (msg.type === 'room:joined') {
            this.localPlayerId = msg.playerId;
            this.latestRoom = msg.room;
            this.onRoomUpdate?.(msg.room, this.localPlayerId);
            return;
          }

          if (msg.type === 'room:snapshot') {
            this.latestRoom = msg.room;
            this.onRoomUpdate?.(msg.room, this.localPlayerId);
            return;
          }

          if (msg.type === 'race:countdown_started') {
            this.latestRoom = msg.room;
            this.onRoomUpdate?.(msg.room, this.localPlayerId);
            this.onRaceTransition?.('COUNTDOWN', msg.room);
            return;
          }

          if (msg.type === 'race:started') {
            this.latestRoom = msg.room;
            this.onRoomUpdate?.(msg.room, this.localPlayerId);
            this.onRaceTransition?.('START', msg.room);
            return;
          }

          if (msg.type === 'race:event' && typeof msg.banner === 'string') {
            this.onEventBanner?.(msg.banner);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (this.isDisposed) return;
        this.onConnectionStatus?.(false);
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1800);
  }

  public sendJoinRoom(roomId: string, name?: string, paintId?: CarPaintId): void {
    this.currentRoomId = (roomId || 'GLOBAL').trim().toUpperCase().slice(0, 12) || 'GLOBAL';
    if (name) this.driverName = name;
    if (paintId) this.paintId = paintId;

    this.sendRaw({
      type: 'room:join',
      roomId: this.currentRoomId,
      name: this.driverName,
      paintId: this.paintId,
    });
  }

  public updateProfile(opts: {
    name?: string;
    paintId?: CarPaintId;
    environmentId?: EnvironmentId;
    isReady?: boolean;
  }): void {
    if (opts.name) this.driverName = opts.name;
    if (opts.paintId) this.paintId = opts.paintId;
    this.sendRaw({
      type: 'player:update_profile',
      ...opts,
    });
  }

  public requestSynchronizedStart(): void {
    this.sendRaw({
      type: 'race:request_start',
    });
  }

  public sendTelemetry(
    payload: {
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
    },
    force = false
  ): void {
    const now = performance.now();
    if (!force && now - this.lastTelemetrySentAt < 45) return;
    this.lastTelemetrySentAt = now;

    this.sendRaw({
      type: 'player:telemetry',
      ...payload,
    });
  }

  public getLocalPlayerId(): string | null {
    return this.localPlayerId;
  }

  public getLatestRoom(): RoomStateSnapshot | null {
    return this.latestRoom;
  }

  private sendRaw(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
  }
}
