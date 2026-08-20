// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Track } from "./api";
import { QuickSearch } from "./App";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeTrack(id: string, name: string): Track {
  const artist = { id: "artist", name: "Clara Joy", images: [], uri: "spotify:artist:artist" };
  return {
    id,
    name,
    artists: [artist],
    album: {
      id: "album",
      name: "Do You Remember Me",
      artists: [artist],
      images: [],
      uri: "spotify:album:album",
    },
    duration_ms: 145_000,
    uri: `spotify:track:${id}`,
  };
}

describe("QuickSearch", () => {
  it("debounces searching and plays the arrow-key selection with Enter", async () => {
    vi.useFakeTimers();
    const first = makeTrack("one", "Graduation");
    const second = makeTrack("two", "Never Tell");
    const onFind = vi.fn().mockResolvedValue({
      tracks: {
        href: "",
        limit: 10,
        next: null,
        offset: 0,
        previous: null,
        total: 2,
        items: [first, second],
      },
    });
    const onPlay = vi.fn();
    const onClose = vi.fn();
    render(<QuickSearch open onClose={onClose} onFind={onFind} onPlay={onPlay} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "clara joy" } });
    expect(onFind).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(220));

    expect(onFind).toHaveBeenCalledWith("clara joy");
    expect(screen.getByRole("option", { name: /Graduation/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onPlay).toHaveBeenCalledWith(second);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
