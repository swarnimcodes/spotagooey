// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaybackQueue, Track } from "./api";
import { QueuePanel } from "./App";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

afterEach(cleanup);

function track(id: string, name: string): Track {
  const artist = { id: "artist", name: "Clara Joy", uri: "spotify:artist:artist", images: [] };
  return {
    id,
    name,
    uri: `spotify:track:${id}`,
    duration_ms: 180_000,
    artists: [artist],
    album: { id: "album", name: "Album", uri: "spotify:album:album", images: [], artists: [artist] },
  };
}

describe("QueuePanel", () => {
  it("shows the current and upcoming Spotify queue and exposes controls", () => {
    const data: PlaybackQueue = {
      items: [
        { id: 1, track: track("next", "Next Song") },
        { id: 2, track: track("later", "Later Song") },
      ],
    };
    const onRefresh = vi.fn();
    const onClose = vi.fn();
    const onRemove = vi.fn();
    const onMove = vi.fn();
    const onClear = vi.fn();
    const onPlayNext = vi.fn();

    render(<QueuePanel
      data={data}
      current={{
        id: "current",
        name: "Playing Now",
        uri: "spotify:track:current",
        artists: track("current", "Playing Now").artists,
        album: track("current", "Playing Now").album,
        image: null,
        duration: 180_000,
      }}
      status="ready"
      error={null}
      onRefresh={onRefresh}
      onPlayNext={onPlayNext}
      onRemove={onRemove}
      onMove={onMove}
      onClear={onClear}
      onClose={onClose}
    />);

    expect(screen.getByText("Playing Now")).toBeInTheDocument();
    expect(screen.getByText("Next Song")).toBeInTheDocument();
    expect(screen.getByText("2 upcoming")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Play next" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Next Song from queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Next Song down" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Close queue" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onPlayNext).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(1);
    expect(onMove).toHaveBeenCalledWith(1, 1);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
