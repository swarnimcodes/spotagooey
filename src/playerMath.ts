import type { LyricsDocument } from "./api";

export function interpolateProgress(
  anchorProgress: number,
  elapsedMs: number,
  duration: number,
  isPlaying: boolean,
): number {
  const next = anchorProgress + (isPlaying ? Math.max(0, elapsedMs) : 0);
  return Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, next));
}

export function activeLyricIndex(document: LyricsDocument | null, progress: number): number {
  if (!document || document.kind !== "synced") return -1;
  let low = 0;
  let high = document.lines.length - 1;
  let active = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const timestamp = document.lines[middle].startMs ?? Number.MAX_SAFE_INTEGER;
    if (timestamp <= progress) {
      active = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return active;
}
