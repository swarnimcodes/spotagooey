import type { PlaybackState, Track } from "./api";

const CACHE_VERSION = 1;
const KEY_PREFIX = "spotagooey.playback.";

export interface CachedPlayback {
  version: 1;
  track: Track;
  progressMs: number;
  capturedAt: number;
  contextUri: string | null;
  shuffleState: boolean;
  repeatState: PlaybackState["repeat_state"];
  volumePercent: number;
  wasPlaying: boolean;
}

function cacheKey(userId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<Track>;
  return typeof track.id === "string"
    && typeof track.name === "string"
    && typeof track.uri === "string"
    && typeof track.duration_ms === "number"
    && Array.isArray(track.artists)
    && Boolean(track.album && typeof track.album === "object");
}

export function playbackCacheFromState(state: PlaybackState, capturedAt = Date.now()): CachedPlayback | null {
  if (!isTrack(state.item)) return null;
  return {
    version: CACHE_VERSION,
    track: state.item,
    progressMs: Math.min(state.item.duration_ms, Math.max(0, state.progress_ms ?? 0)),
    capturedAt,
    contextUri: state.context?.uri ?? null,
    shuffleState: state.shuffle_state,
    repeatState: state.repeat_state,
    volumePercent: state.device?.volume_percent ?? 50,
    wasPlaying: state.is_playing,
  };
}

export function loadPlaybackCache(userId: string, storage?: Storage): CachedPlayback | null {
  try {
    const target = storage ?? browserStorage();
    if (!target) return null;
    const value = JSON.parse(target.getItem(cacheKey(userId)) ?? "null") as Partial<CachedPlayback> | null;
    if (!value
      || value.version !== CACHE_VERSION
      || !isTrack(value.track)
      || typeof value.progressMs !== "number"
      || typeof value.capturedAt !== "number") {
      return null;
    }
    return {
      version: CACHE_VERSION,
      track: value.track,
      progressMs: Math.min(value.track.duration_ms, Math.max(0, value.progressMs)),
      capturedAt: value.capturedAt,
      contextUri: typeof value.contextUri === "string" ? value.contextUri : null,
      shuffleState: Boolean(value.shuffleState),
      repeatState: value.repeatState === "track" || value.repeatState === "context" ? value.repeatState : "off",
      volumePercent: typeof value.volumePercent === "number" ? Math.min(100, Math.max(0, value.volumePercent)) : 50,
      wasPlaying: Boolean(value.wasPlaying),
    };
  } catch {
    return null;
  }
}

export function savePlaybackCache(userId: string, value: CachedPlayback, storage?: Storage): void {
  try {
    const target = storage ?? browserStorage();
    target?.setItem(cacheKey(userId), JSON.stringify(value));
  } catch {
    // Playback restoration is best effort; storage may be unavailable or full.
  }
}
