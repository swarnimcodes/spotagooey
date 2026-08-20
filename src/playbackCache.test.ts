// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { PlaybackState, Track } from "./api";
import { loadPlaybackCache, playbackCacheFromState, savePlaybackCache } from "./playbackCache";

const track: Track = {
  id: "track",
  name: "Graduation",
  uri: "spotify:track:track",
  duration_ms: 165_000,
  artists: [{ id: "artist", name: "Clara Joy", uri: "spotify:artist:artist", images: [] }],
  album: {
    id: "album",
    name: "Do You Remember Me",
    uri: "spotify:album:album",
    images: [],
    artists: [],
  },
};

const state: PlaybackState = {
  device: {
    id: "device",
    is_active: true,
    is_private_session: false,
    is_restricted: false,
    name: "Spotagooey",
    type: "Computer",
    volume_percent: 72,
  },
  repeat_state: "context",
  shuffle_state: true,
  context: { uri: "spotify:album:album", type: "album" },
  progress_ms: 42_000,
  timestamp: 123,
  is_playing: true,
  item: track,
  actions: {},
};

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("playback cache", () => {
  it("round-trips the last observed track and position per user", () => {
    const storage = new MemoryStorage();
    const cached = playbackCacheFromState(state, 1_000);
    expect(cached).not.toBeNull();
    savePlaybackCache("user/a", cached!, storage);

    expect(loadPlaybackCache("user/a", storage)).toEqual(cached);
    expect(loadPlaybackCache("another-user", storage)).toBeNull();
  });

  it("ignores malformed stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem("spotagooey.playback.user", "not-json");
    expect(loadPlaybackCache("user", storage)).toBeNull();
  });
});
