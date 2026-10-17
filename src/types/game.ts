export enum GameState {
  TITLE = 'TITLE',
  COUNTDOWN = 'COUNTDOWN',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  VICTORY = 'VICTORY',
  GAME_OVER = 'GAME_OVER',
}

export enum CameraMode {
  CHASE = 'CHASE',
  COCKPIT = 'COCKPIT',
  AERIAL = 'AERIAL',
}

export enum EnvironmentId {
  SUNSET_CANYON = 'SUNSET_CANYON',
  NIGHT_METROPOLIS = 'NIGHT_METROPOLIS',
  ALPINE_CIRCUIT = 'ALPINE_CIRCUIT',
}

export enum CarPaintId {
  SOLAR_AMBER = 'SOLAR_AMBER',
  CRIMSON_CORSA = 'CRIMSON_CORSA',
  ELECTRIC_CYAN = 'ELECTRIC_CYAN',
  TITANIUM_SILVER = 'TITANIUM_SILVER',
  EMERALD_GT = 'EMERALD_GT',
}

export interface CarPaintPreset {
  id: CarPaintId;
  name: string;
  hex: string;
  accentHex: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
}

export interface EnvironmentPreset {
  id: EnvironmentId;
  name: string;
  subtitle: string;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  keyLightColor: number;
  keyLightIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  groundColor: number;
  sceneryPrimaryColor: number;
  scenerySecondaryColor: number;
  accentGlowColor: number;
}

export interface OnlinePlayerState {
  id: string;
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

export type RoomStatus = 'LOBBY' | 'COUNTDOWN' | 'RACING';

export interface RoomStateSnapshot {
  roomId: string;
  environmentId: EnvironmentId;
  status: RoomStatus;
  countdownSeconds: number;
  players: OnlinePlayerState[];
}

export interface TelemetryData {
  speedKmh: number;
  rpm: number; // 1000 to 9000
  gear: number; // 1 to 6
  nitro: number; // 0 to 100
  isBoosting: boolean;
  isDrifting: boolean;
  shield: number; // 0 to 100
  score: number;
  combo: number;
  nearMisses: number;
  lap: number;
  totalLaps: number;
  lapTimeMs: number;
  bestLapTimeMs: number | null;
  totalTimeMs: number;
  distanceMeters: number;
  lapProgress: number; // 0 to 1
  positionRank: number;
  totalRacers: number;
  eventBanner: string | null;
}

export const CAR_PAINT_PRESETS: CarPaintPreset[] = [
  {
    id: CarPaintId.SOLAR_AMBER,
    name: 'Solar Amber',
    hex: '#F59E0B',
    accentHex: '#06B6D4',
    metalness: 0.85,
    roughness: 0.16,
    clearcoat: 1.0,
  },
  {
    id: CarPaintId.CRIMSON_CORSA,
    name: 'Crimson Corsa',
    hex: '#EF4444',
    accentHex: '#F59E0B',
    metalness: 0.82,
    roughness: 0.18,
    clearcoat: 1.0,
  },
  {
    id: CarPaintId.ELECTRIC_CYAN,
    name: 'Electric Cyan',
    hex: '#06B6D4',
    accentHex: '#F59E0B',
    metalness: 0.88,
    roughness: 0.14,
    clearcoat: 1.0,
  },
  {
    id: CarPaintId.TITANIUM_SILVER,
    name: 'Liquid Titanium',
    hex: '#CBD5E1',
    accentHex: '#EF4444',
    metalness: 0.94,
    roughness: 0.12,
    clearcoat: 1.0,
  },
  {
    id: CarPaintId.EMERALD_GT,
    name: 'Verde Mantis',
    hex: '#10B981',
    accentHex: '#F59E0B',
    metalness: 0.84,
    roughness: 0.16,
    clearcoat: 1.0,
  },
];

export const ENVIRONMENT_PRESETS: Record<EnvironmentId, EnvironmentPreset> = {
  [EnvironmentId.SUNSET_CANYON]: {
    id: EnvironmentId.SUNSET_CANYON,
    name: 'Red Rock Canyon',
    subtitle: 'Golden Hour Highway · 3 Laps',
    skyColor: 0x1a0f1e,
    fogColor: 0x261424,
    fogDensity: 0.0055,
    keyLightColor: 0xff9e5e,
    keyLightIntensity: 2.6,
    hemiSkyColor: 0xff7b54,
    hemiGroundColor: 0x2b1810,
    hemiIntensity: 0.85,
    groundColor: 0x2c1914,
    sceneryPrimaryColor: 0x6e3528,
    scenerySecondaryColor: 0x8c4734,
    accentGlowColor: 0xf59e0b,
  },
  [EnvironmentId.NIGHT_METROPOLIS]: {
    id: EnvironmentId.NIGHT_METROPOLIS,
    name: 'Neo Bay Overpass',
    subtitle: 'Midnight Expressway · 3 Laps',
    skyColor: 0x060913,
    fogColor: 0x080d1a,
    fogDensity: 0.006,
    keyLightColor: 0x7dd3fc,
    keyLightIntensity: 2.1,
    hemiSkyColor: 0x38bdf8,
    hemiGroundColor: 0x090d16,
    hemiIntensity: 0.75,
    groundColor: 0x0b101b,
    sceneryPrimaryColor: 0x162032,
    scenerySecondaryColor: 0x1e293b,
    accentGlowColor: 0x06b6d4,
  },
  [EnvironmentId.ALPINE_CIRCUIT]: {
    id: EnvironmentId.ALPINE_CIRCUIT,
    name: 'Nordic Pass GP',
    subtitle: 'High Altitude Circuit · 3 Laps',
    skyColor: 0x0f1a2c,
    fogColor: 0x16243b,
    fogDensity: 0.0052,
    keyLightColor: 0xfffbeb,
    keyLightIntensity: 2.5,
    hemiSkyColor: 0x93c5fd,
    hemiGroundColor: 0x1e293b,
    hemiIntensity: 0.9,
    groundColor: 0x172330,
    sceneryPrimaryColor: 0x1e3a2f,
    scenerySecondaryColor: 0x334155,
    accentGlowColor: 0x38bdf8,
  },
};
