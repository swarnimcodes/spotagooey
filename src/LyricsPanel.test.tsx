// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LyricsDocument } from "./api";
import { FullPlayer, LyricsPanel } from "./App";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(cleanup);

const synced: LyricsDocument = {
  trackId: "track",
  source: "lrclib",
  kind: "synced",
  sourceUrl: "https://lrclib.net",
  lines: [
    { startMs: 1_000, text: "First line" },
    { startMs: 2_000, text: "Second line" },
  ],
};

describe("LyricsPanel", () => {
  it("highlights synchronized progress and seeks from a line", () => {
    const onSeek = vi.fn();
    render(<LyricsPanel document={synced} status="ready" error={null} progress={2_200} onSeek={onSeek} onRetry={vi.fn()} />);

    const active = screen.getByRole("button", { name: "Second line" });
    expect(active).toHaveAttribute("data-active", "true");
    fireEvent.click(active);
    expect(onSeek).toHaveBeenCalledWith(2_000);
    expect(screen.getByText("Lyrics from LRCLIB ↗")).toBeInTheDocument();
  });

  it("labels Genius lyrics as unsynchronized", () => {
    render(<LyricsPanel document={{ ...synced, source: "genius", kind: "plain", sourceUrl: "https://genius.com/song", lines: [{ startMs: null, text: "Plain line" }] }} status="ready" error={null} progress={5_000} onSeek={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByText("Unsynchronized")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plain line" })).toBeDisabled();
    expect(screen.getByText("Lyrics from Genius ↗")).toBeInTheDocument();
  });

  it("renders an unavailable state without fabricating lyrics", () => {
    render(<LyricsPanel document={null} status="unavailable" error={null} progress={0} onSeek={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("No lyrics found.")).toBeInTheDocument();
    expect(screen.queryByText("Unsynchronized")).not.toBeInTheDocument();
  });
});

describe("FullPlayer", () => {
  it("toggles between lyrics and centered artwork layouts", () => {
    const noop = vi.fn();
    render(
      <FullPlayer
        track={null}
        player={null}
        progress={0}
        document={synced}
        lyricsStatus="ready"
        lyricsError={null}
        onClose={noop}
        onToggle={noop}
        onNext={noop}
        onPrev={noop}
        onShuffle={noop}
        onRepeat={noop}
        onSeek={noop}
        onVolume={noop}
        onDevices={noop}
        onRetry={noop}
      />
    );

    const player = screen.getByRole("dialog", { name: "Now playing" });
    expect(player).toHaveClass("with-lyrics");
    fireEvent.click(screen.getByRole("button", { name: "Hide lyrics" }));
    expect(player).toHaveClass("without-lyrics");
    expect(screen.getByRole("button", { name: "Show lyrics" })).toHaveAttribute("aria-pressed", "false");
  });
});
