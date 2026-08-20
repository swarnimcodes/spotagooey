import { describe, expect, it } from "vitest";
import type { LyricsDocument } from "./api";
import { activeLyricIndex, interpolateProgress } from "./playerMath";

const synced: LyricsDocument = {
  trackId: "track",
  source: "lrclib",
  kind: "synced",
  sourceUrl: "https://lrclib.net",
  lines: [
    { startMs: 1_000, text: "One" },
    { startMs: 2_500, text: "Two" },
    { startMs: 5_000, text: "Three" },
  ],
};

describe("activeLyricIndex", () => {
  it("selects the latest line at or before progress", () => {
    expect(activeLyricIndex(synced, 999)).toBe(-1);
    expect(activeLyricIndex(synced, 1_000)).toBe(0);
    expect(activeLyricIndex(synced, 4_999)).toBe(1);
    expect(activeLyricIndex(synced, 9_000)).toBe(2);
  });

  it("does not highlight unsynchronized lyrics", () => {
    expect(activeLyricIndex({ ...synced, kind: "plain" }, 5_000)).toBe(-1);
  });
});

describe("interpolateProgress", () => {
  it("advances only while playing and clamps at duration", () => {
    expect(interpolateProgress(1_000, 500, 10_000, true)).toBe(1_500);
    expect(interpolateProgress(1_000, 500, 10_000, false)).toBe(1_000);
    expect(interpolateProgress(9_900, 500, 10_000, true)).toBe(10_000);
  });
});
