import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Album,
  AppInfo,
  Artist,
  Device,
  LoginResult,
  LyricsDocument,
  NativePlaybackInfo,
  PlaybackState,
  Playlist,
  PlaylistTrack,
  SearchCategory,
  SearchResults,
  Track,
  addToQueue,
  album as albumApi,
  appInfo,
  artistTopTracks,
  devices,
  imageOf,
  getLyrics,
  login,
  nativePlaybackStatus,
  logout,
  msToTime,
  pause,
  play,
  playbackState,
  playlistItems,
  playlists,
  resume,
  savedAlbums,
  savedTracks,
  search,
  searchCategory,
  seek,
  session,
  setClientId,
  setRepeat,
  setShuffle,
  setVolume,
  startNativePlayback,
  skipNext,
  skipPrevious,
  trackKey,
  transferPlayback,
} from "./api";
import "./App.css";
import { applyTheme, availableThemes, initialTheme } from "./themes";
import { activeLyricIndex, interpolateProgress } from "./playerMath";
import {
  loadPlaybackCache,
  playbackCacheFromState,
  savePlaybackCache,
  type CachedPlayback,
} from "./playbackCache";

type View =
  | { name: "home" }
  | { name: "search" }
  | { name: "library" }
  | { name: "playlist"; id: string }
  | { name: "album"; id: string }
  | { name: "artist"; id: string };

interface Shelves {
  savedAlbums: Album[];
  playlists: Playlist[];
  savedTracks: Track[];
}

interface TrackListData {
  title: string;
  subtitle: string;
  artwork: string | null;
  tracks: Track[];
  playUri: string;
}

interface CurrentTrack {
  id: string;
  name: string;
  artists: Artist[];
  album?: Album;
  image: string | null;
  uri: string;
  duration: number;
}

type LyricsStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

function usePlaybackClock(player: PlaybackState | null, duration: number): number {
  const [progress, setProgress] = useState(player?.progress_ms ?? 0);
  const anchor = useRef({ progress: player?.progress_ms ?? 0, at: performance.now() });

  useEffect(() => {
    const next = player?.progress_ms ?? 0;
    anchor.current = { progress: next, at: performance.now() };
    setProgress(next);
  }, [player?.progress_ms, player?.timestamp, player?.item, player?.is_playing]);

  useEffect(() => {
    if (!player?.is_playing) return;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - anchor.current.at;
      setProgress(interpolateProgress(anchor.current.progress, elapsed, duration, true));
    }, 100);
    return () => window.clearInterval(timer);
  }, [player?.is_playing, duration]);

  return Math.max(0, progress);
}

async function fetchShelves(): Promise<{ shelves: Shelves; errors: string[] }> {
  const [playlistResult, albumResult, trackResult] = await Promise.allSettled([
    playlists(),
    savedAlbums(),
    savedTracks(),
  ]);

  const errors = [playlistResult, albumResult, trackResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String(result.reason));

  return {
    shelves: {
      playlists: playlistResult.status === "fulfilled" ? playlistResult.value.items : [],
      savedAlbums:
        albumResult.status === "fulfilled"
          ? albumResult.value.items.map((item) => item.album)
          : [],
      savedTracks:
        trackResult.status === "fulfilled"
          ? trackResult.value.items.map((item) => item.track)
          : [],
    },
    errors,
  };
}

function App() {
  const themes = useMemo(() => availableThemes(), []);
  const [themeId, setThemeId] = useState(() => initialTheme().id);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [user, setUser] = useState<LoginResult | null>(null);
  const [nativePlayback, setNativePlayback] = useState<NativePlaybackInfo | null>(null);

  const [view, setView] = useState<View>({ name: "home" });
  const [shelves, setShelves] = useState<Shelves>({ savedAlbums: [], playlists: [], savedTracks: [] });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeSearchCategory, setActiveSearchCategory] = useState<SearchCategory | null>(null);
  const [categoryResults, setCategoryResults] = useState<SearchResults | null>(null);
  const [categorySearching, setCategorySearching] = useState(false);
  const searchSequence = useRef(0);
  const categorySequence = useRef(0);

  const [player, setPlayer] = useState<PlaybackState | null>(null);
  const [restoredPlayback, setRestoredPlayback] = useState<CachedPlayback | null>(null);
  const lastPlaybackCacheWrite = useRef({ at: 0, trackId: "", isPlaying: false });
  const [deviceList, setDeviceList] = useState<Device[]>([]);
  const [showDevices, setShowDevices] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsDocument | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>("idle");
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [lyricsRetry, setLyricsRetry] = useState(0);

  const [listData, setListData] = useState<TrackListData | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Record<string, Track[]>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (user) setShowQuickSearch((visible) => !visible);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [user]);

  const boot = useCallback(async () => {
    try {
      const i = await appInfo();
      setInfo(i);
      const u = await session();
      setUser(u);
      if (u) {
        const loaded = await fetchShelves();
        setShelves(loaded.shelves);
        if (loaded.errors.length) notify(loaded.errors.join(" · "));
      }
    } catch (e) {
      setUser(null);
      notify(String(e));
    }
  }, [notify]);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const cached = loadPlaybackCache(user.id);
    setPlayer(null);
    setRestoredPlayback(cached);

    const poll = async () => {
      try {
        const live = await playbackState();
        if (!active) return;
        setPlayer(live);
        if (live?.item) setRestoredPlayback(null);
        else setRestoredPlayback((current) => current ?? loadPlaybackCache(user.id));
      } catch {
        /* Keep the locally restored paused state when Spotify has no session. */
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [user]);

  useEffect(() => {
    if (!user || !player) return;
    const cached = playbackCacheFromState(player);
    if (!cached) return;
    const previous = lastPlaybackCacheWrite.current;
    const now = Date.now();
    const stateChanged = previous.trackId !== cached.track.id || previous.isPlaying !== cached.wasPlaying;
    if (!stateChanged && now - previous.at < 5_000) return;
    savePlaybackCache(user.id, cached);
    lastPlaybackCacheWrite.current = { at: now, trackId: cached.track.id, isPlaying: cached.wasPlaying };
  }, [player, user]);

  useEffect(() => {
    if (!user) {
      setNativePlayback(null);
      return;
    }

    let active = true;
    setNativePlayback({
      state: "starting",
      deviceName: "Spotagooey",
      deviceId: null,
      error: null,
    });

    const update = async (start = false) => {
      try {
        const status = start ? await startNativePlayback() : await nativePlaybackStatus();
        if (!active) return;
        setNativePlayback(status);
        if (status.state === "failed" && status.error) notify(status.error);
      } catch (error) {
        if (!active) return;
        setNativePlayback({
          state: "failed",
          deviceName: "Spotagooey",
          deviceId: null,
          error: String(error),
        });
        notify(String(error));
      }
    };

    void update(true);
    const id = setInterval(() => void update(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [user, notify]);

  const doLogin = useCallback(async () => {
    try {
      const u = await login();
      setUser(u);
      const loaded = await fetchShelves();
      setShelves(loaded.shelves);
      notify(
        loaded.errors.length
          ? loaded.errors.join(" · ")
          : `Welcome${u.displayName ? `, ${u.displayName}` : ""}`
      );
    } catch (e) {
      notify(String(e));
    }
  }, [notify]);

  const doLogout = useCallback(async () => {
    await logout();
    setUser(null);
    setPlayer(null);
    setRestoredPlayback(null);
    setView({ name: "home" });
  }, []);

  const saveClientId = useCallback(async (id: string) => {
    await setClientId(id);
    setInfo(await appInfo());
  }, []);

  const openPlaylist = useCallback(
    async (id: string) => {
      setView({ name: "playlist", id });
      const p = shelves.playlists.find((x) => x.id === id);
      try {
        let tracks = playlistTracks[id];
        if (!tracks) {
          const page = await playlistItems(id);
          tracks = page.items
            .map((i: PlaylistTrack) => i.track)
            .filter((t): t is Track => "album" in t && typeof t.id === "string");
          setPlaylistTracks((m) => ({ ...m, [id]: tracks }));
        }
        setListData({
          title: p?.name ?? `Playlist`,
          subtitle: p?.owner?.display_name ?? "Playlist",
          artwork: imageOf(p ? { images: p.images ?? [] } : null, 300),
          tracks,
          playUri: p?.uri ?? `spotify:playlist:${id}`,
        });
      } catch (e) {
        notify(String(e));
      }
    },
    [notify, playlistTracks, shelves.playlists]
  );

  const openAlbum = useCallback(
    async (id: string) => {
      setView({ name: "album", id });
      try {
        const a = await albumApi(id);
        const tracks = (a.tracks?.items ?? []).map((t) => ({ ...t, album: a }));
        setListData({
          title: a.name,
          subtitle: a.artists.map((ar) => ar.name).join(", "),
          artwork: imageOf(a, 300),
          tracks,
          playUri: a.uri,
        });
      } catch (e) {
        notify(String(e));
      }
    },
    [notify]
  );

  const openArtist = useCallback(
    async (id: string) => {
      setView({ name: "artist", id });
      try {
        const res = await artistTopTracks(id);
        const tracks = res.tracks.filter((t): t is Track => Boolean(t));
        setListData({ title: "Top Songs", subtitle: "", artwork: null, tracks, playUri: `spotify:artist:${id}` });
      } catch (e) {
        notify(String(e));
      }
    },
    [notify]
  );

  const doSearch = useCallback((q: string) => {
    searchSequence.current += 1;
    setQuery(q);
    setResults(null);
    setSearching(Boolean(q.trim()));
    setActiveSearchCategory(null);
    setCategoryResults(null);
    categorySequence.current += 1;
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const sequence = ++searchSequence.current;
    if (!trimmed) {
      setResults(null);
      setSearching(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const next = await search(trimmed);
        if (searchSequence.current === sequence) setResults(next);
      } catch (e) {
        if (searchSequence.current === sequence) notify(String(e));
      } finally {
        if (searchSequence.current === sequence) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, notify]);

  const showSearchCategory = useCallback(
    async (category: SearchCategory | null, offset = 0) => {
      if (!category) {
        categorySequence.current += 1;
        setActiveSearchCategory(null);
        setCategoryResults(null);
        setCategorySearching(false);
        return;
      }
      const trimmed = query.trim();
      if (!trimmed) return;

      const sequence = ++categorySequence.current;
      setActiveSearchCategory(category);
      setCategoryResults(null);
      setCategorySearching(true);
      try {
        const next = await searchCategory(trimmed, category, offset);
        if (categorySequence.current === sequence) setCategoryResults(next);
      } catch (e) {
        if (categorySequence.current === sequence) notify(String(e));
      } finally {
        if (categorySequence.current === sequence) setCategorySearching(false);
      }
    },
    [query, notify]
  );

  const findQuickTracks = useCallback(
    (value: string) => searchCategory(value, "tracks"),
    []
  );

  const startTracks = useCallback(
    async (uris: string[], contextUri?: string, offsetUri?: string) => {
      try {
        await play({ contextUri, uris });
        notify(offsetUri ? "Playing from selection" : "Playing");
      } catch (e) {
        notify(String(e));
      }
    },
    [notify]
  );

  const togglePlay = useCallback(async () => {
    if (!player && !restoredPlayback) return;
    try {
      if (!player && restoredPlayback) {
        await play({ uris: [restoredPlayback.track.uri], positionMs: restoredPlayback.progressMs });
      } else if (player?.is_playing) {
        await pause();
      } else {
        await resume();
      }
      const live = await playbackState();
      if (live) {
        setPlayer(live);
        setRestoredPlayback(null);
      }
    } catch (e) {
      notify(String(e));
    }
  }, [player, restoredPlayback, notify]);

  const moveTrack = useCallback(async (direction: "next" | "previous") => {
    try {
      if (direction === "next") await skipNext();
      else await skipPrevious();
      setLyrics(null);
      setLyricsStatus("loading");
      setPlayer(await playbackState());
    } catch (error) {
      notify(`Failed to skip track: ${error}`);
    }
  }, [notify]);

  const seekTo = useCallback(
    async (ms: number) => {
      if (!player && restoredPlayback && user) {
        const updated = { ...restoredPlayback, progressMs: ms, capturedAt: Date.now() };
        setRestoredPlayback(updated);
        savePlaybackCache(user.id, updated);
        return;
      }
      try {
        await seek(ms);
        setPlayer((p) => (p ? { ...p, progress_ms: ms } : p));
      } catch (e) {
        notify(String(e));
      }
    },
    [player, restoredPlayback, user, notify]
  );

  const queueTrack = useCallback(
    async (uri: string) => {
      try {
        await addToQueue(uri);
        notify("Added to queue");
      } catch (e) {
        notify(String(e));
      }
    },
    [notify]
  );

  const restoredPlayer = useMemo<PlaybackState | null>(() => restoredPlayback ? {
    device: {
      id: null,
      is_active: false,
      is_private_session: false,
      is_restricted: false,
      name: "Spotagooey",
      type: "Computer",
      volume_percent: restoredPlayback.volumePercent,
    },
    repeat_state: restoredPlayback.repeatState,
    shuffle_state: restoredPlayback.shuffleState,
    context: restoredPlayback.contextUri ? { uri: restoredPlayback.contextUri, type: "restored" } : null,
    progress_ms: restoredPlayback.progressMs,
    timestamp: restoredPlayback.capturedAt,
    is_playing: false,
    item: restoredPlayback.track,
    actions: {},
  } : null, [restoredPlayback]);
  const displayPlayer = player ?? restoredPlayer;

  const currentTrack = useMemo<CurrentTrack | null>(() => {
    const item = displayPlayer?.item;
    if (!item || !("album" in item) || !("artists" in item)) return null;
    const tr = item as Track;
    return { id: tr.id, name: tr.name ?? "Unknown", artists: tr.artists ?? [], album: tr.album, image: imageOf(tr.album, 640), uri: tr.uri, duration: tr.duration_ms ?? 0 };
  }, [displayPlayer]);

  const displayProgress = usePlaybackClock(displayPlayer, currentTrack?.duration ?? 0);
  const currentArtistsKey = currentTrack?.artists.map((artist) => artist.name).join("\u0000") ?? "";
  const lyricsVisible = showLyrics || showFullPlayer;

  useEffect(() => {
    if (!lyricsVisible) return;
    if (!currentTrack) {
      setLyrics(null);
      setLyricsStatus("unavailable");
      setLyricsError(null);
      return;
    }

    let active = true;
    const requestedTrackId = currentTrack.id;
    setLyrics(null);
    setLyricsStatus("loading");
    setLyricsError(null);
    void getLyrics({
      trackId: requestedTrackId,
      title: currentTrack.name,
      artists: currentArtistsKey.split("\u0000").filter(Boolean),
      album: currentTrack.album?.name ?? "",
      durationMs: currentTrack.duration,
    })
      .then((document) => {
        if (!active || document?.trackId && document.trackId !== requestedTrackId) return;
        setLyrics(document);
        setLyricsStatus(document ? "ready" : "unavailable");
      })
      .catch((error) => {
        if (!active) return;
        setLyrics(null);
        setLyricsStatus("error");
        setLyricsError(String(error));
      });
    return () => {
      active = false;
    };
  }, [
    lyricsVisible,
    lyricsRetry,
    currentTrack?.id,
    currentTrack?.name,
    currentTrack?.duration,
    currentTrack?.album?.name,
    currentArtistsKey,
  ]);

  const openDevices = useCallback(async () => {
    try {
      const d = await devices();
      setDeviceList(d.devices);
      setShowDevices(true);
    } catch (e) {
      notify(String(e));
    }
  }, [notify]);

  const switchDevice = useCallback(
    async (deviceId: string) => {
      try {
        await transferPlayback(deviceId);
        setShowDevices(false);
        notify("Switched device");
      } catch (e) {
        notify(String(e));
      }
    },
    [notify]
  );

  const nav = [
    { key: "home", label: "Home" },
    { key: "search", label: "Search" },
    { key: "library", label: "Library" },
  ] as const;

  const changeTheme = useCallback((id: string) => {
    setThemeId(applyTheme(id).id);
  }, []);

  return (
    <div className={`app ${showLyrics && user ? "lyrics-open" : ""}`}>
      <Sidebar user={user} nativePlayback={nativePlayback} nav={nav} view={view} onNav={setView} onLogout={doLogout} playlistCount={shelves.playlists.length} themes={themes} themeId={themeId} onTheme={changeTheme} />
      <main className="content" onClick={() => showDevices && setShowDevices(false)}>
        {!user ? (
          <LoginScreen info={info} onLogin={doLogin} onSaveClientId={saveClientId} />
        ) : (
          <>
            {view.name === "home" && (
              <HomeView shelves={shelves} onAlbum={openAlbum} onPlaylist={openPlaylist} onPlayAll={startTracks} onSearch={() => setView({ name: "search" })} />
            )}
            {view.name === "search" && (
              <SearchView
                query={query}
                searching={searching}
                categorySearching={categorySearching}
                activeCategory={activeSearchCategory}
                onQuery={doSearch}
                results={results}
                categoryResults={categoryResults}
                onCategory={showSearchCategory}
                onAlbum={openAlbum}
                onArtist={openArtist}
                onPlaylist={openPlaylist}
                onTrack={startTracks}
                onQueue={queueTrack}
              />
            )}
            {view.name === "library" && (
              <LibraryView shelves={shelves} onAlbum={openAlbum} onPlaylist={openPlaylist} />
            )}
            {(view.name === "playlist" || view.name === "album" || view.name === "artist") && listData && (
              <TrackListView
                data={listData}
                onBack={() => setView({ name: "home" })}
                onPlayAll={startTracks}
                onQueue={queueTrack}
              />
            )}
          </>
        )}
      </main>
      {user && showLyrics && (
        <LyricsPanel
          document={lyrics}
          status={lyricsStatus}
          error={lyricsError}
          progress={displayProgress}
          onSeek={seekTo}
          onRetry={() => setLyricsRetry((value) => value + 1)}
          onClose={() => setShowLyrics(false)}
        />
      )}
      {user && (
        <NowPlayingBar
          track={currentTrack}
          player={displayPlayer}
          restored={!player && Boolean(restoredPlayback)}
          progress={displayProgress}
          onToggle={togglePlay}
          onNext={() => void moveTrack("next")}
          onPrev={() => void moveTrack("previous")}
          onShuffle={() => setShuffle(!player?.shuffle_state).catch(() => notify("failed"))}
          onRepeat={() => setRepeat(player?.repeat_state === "off" ? "context" : player?.repeat_state === "context" ? "track" : "off").catch(() => notify("failed"))}
          onSeek={seekTo}
          onVolume={(v) => setVolume(v).catch(() => notify("failed"))}
          onDevices={openDevices}
          onLyrics={() => setShowLyrics((visible) => !visible)}
          lyricsOpen={showLyrics}
          onFullscreen={() => currentTrack && setShowFullPlayer(true)}
        />
      )}
      {showDevices && (
        <DeviceSheet devices={deviceList} activeId={player?.device?.id ?? null} onPick={switchDevice} onClose={() => setShowDevices(false)} />
      )}
      {user && showFullPlayer && (
        <FullPlayer
          track={currentTrack}
          player={displayPlayer}
          restored={!player && Boolean(restoredPlayback)}
          progress={displayProgress}
          document={lyrics}
          lyricsStatus={lyricsStatus}
          lyricsError={lyricsError}
          onClose={() => setShowFullPlayer(false)}
          onToggle={togglePlay}
          onNext={() => void moveTrack("next")}
          onPrev={() => void moveTrack("previous")}
          onShuffle={() => setShuffle(!player?.shuffle_state).catch(() => notify("failed"))}
          onRepeat={() => setRepeat(player?.repeat_state === "off" ? "context" : player?.repeat_state === "context" ? "track" : "off").catch(() => notify("failed"))}
          onSeek={seekTo}
          onVolume={(value) => setVolume(value).catch(() => notify("failed"))}
          onDevices={openDevices}
          onRetry={() => setLyricsRetry((value) => value + 1)}
        />
      )}
      {user && (
        <QuickSearch
          open={showQuickSearch}
          onClose={() => setShowQuickSearch(false)}
          onFind={findQuickTracks}
          onPlay={(track) => {
            void startTracks([track.uri]);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function QuickSearch(props: {
  open: boolean;
  onClose: () => void;
  onFind: (query: string) => Promise<SearchResults>;
  onPlay: (track: Track) => void;
}) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!props.open) {
      requestSequence.current += 1;
      return;
    }
    setQuery("");
    setTracks([]);
    setSelected(0);
    setLoading(false);
    requestSequence.current += 1;
    inputRef.current?.focus();
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const trimmed = query.trim();
    const sequence = ++requestSequence.current;
    if (!trimmed) {
      setTracks([]);
      setSelected(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await props.onFind(trimmed);
        if (requestSequence.current !== sequence) return;
        setTracks((results.tracks?.items ?? []).filter((track): track is Track => Boolean(track)));
        setSelected(0);
      } catch {
        if (requestSequence.current === sequence) setTracks([]);
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [props.open, props.onFind, query]);

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!props.open) return null;

  const playSelected = () => {
    const track = tracks[selected];
    if (track) {
      props.onPlay(track);
      props.onClose();
    }
  };

  return (
    <div className="quick-search-backdrop" onMouseDown={props.onClose}>
      <section className="quick-search" role="dialog" aria-modal="true" aria-label="Quick search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-search-input-wrap">
          <span className="quick-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="quick-search-input"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                if (tracks.length) setSelected((index) => Math.min(tracks.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                playSelected();
              }
            }}
            placeholder="Search for a song"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="quick-search-results"
            aria-activedescendant={tracks[selected] ? `quick-track-${tracks[selected].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? <span className="quick-search-spinner" aria-label="Searching" /> : <kbd>Esc</kbd>}
        </div>
        <div className="quick-search-results" id="quick-search-results" role="listbox">
          {!query.trim() && <p className="quick-search-hint">Start typing to find a song</p>}
          {query.trim() && !loading && !tracks.length && <p className="quick-search-hint">No songs found</p>}
          {tracks.map((track, index) => {
            const artwork = imageOf(track.album, 60);
            return (
              <button
                ref={(element) => { rowRefs.current[index] = element; }}
                id={`quick-track-${track.id}`}
                className={`quick-search-result ${index === selected ? "selected" : ""}`}
                role="option"
                aria-selected={index === selected}
                key={trackKey(track)}
                onMouseMove={() => setSelected(index)}
                onClick={() => {
                  props.onPlay(track);
                  props.onClose();
                }}
              >
                {artwork ? <img src={artwork} alt="" /> : <span className="quick-search-art-placeholder">♪</span>}
                <span className="quick-search-result-main">
                  <strong>{track.name}</strong>
                  <small>{track.artists.map((artist) => artist.name).join(", ")}</small>
                </span>
                <span className="quick-search-album">{track.album?.name}</span>
                <span className="quick-search-duration">{msToTime(track.duration_ms)}</span>
              </button>
            );
          })}
        </div>
        {!!tracks.length && (
          <footer className="quick-search-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span><kbd>↵</kbd> Play</span>
          </footer>
        )}
      </section>
    </div>
  );
}

function Sidebar(props: {
  user: LoginResult | null;
  nativePlayback: NativePlaybackInfo | null;
  nav: readonly { key: string; label: string }[];
  view: View;
  onNav: (v: View) => void;
  onLogout: () => void;
  playlistCount: number;
  themes: { id: string; name: string }[];
  themeId: string;
  onTheme: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-icon">♪</span>
        <span className="brand-name">Spotagooey</span>
      </div>
      <nav className="nav">
        {props.nav.map((n) => (
          <button
            key={n.key}
            className={"nav-item" + (props.view.name === n.key ? " active" : "")}
            onClick={() => props.onNav({ name: n.key } as View)}
          >
            {n.label}
            {n.key === "search" && <kbd className="nav-shortcut">Ctrl K</kbd>}
          </button>
        ))}
        <button className="nav-item" onClick={() => props.onNav({ name: "library" })}>
          Playlists
          <span className="nav-count">{props.playlistCount}</span>
        </button>
      </nav>
      <div className="sidebar-spacer" />
      <label className="theme-picker">
        <span>Appearance</span>
        <select value={props.themeId} onChange={(event) => props.onTheme(event.currentTarget.value)}>
          {props.themes.map((theme) => (
            <option key={theme.id} value={theme.id}>{theme.name}</option>
          ))}
        </select>
      </label>
      {props.user && props.nativePlayback && (
        <div className={`native-status ${props.nativePlayback.state}`} title={props.nativePlayback.error ?? undefined}>
          <span className="native-status-dot" />
          <span>
            {props.nativePlayback.state === "ready"
              ? "Local audio ready"
              : props.nativePlayback.state === "starting"
                ? "Starting local audio…"
                : "Local audio unavailable"}
          </span>
        </div>
      )}
      {props.user && (
        <div className="user-chip">
          {props.user.imageUrl ? (
            <img className="user-avatar" src={props.user.imageUrl} alt="" />
          ) : (
            <div className="user-avatar placeholder">{props.user.displayName?.[0] ?? "?"}</div>
          )}
          <div className="user-meta">
            <div className="user-name">{props.user.displayName ?? props.user.id}</div>
            <button className="user-logout" onClick={props.onLogout}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function LoginScreen(props: {
  info: AppInfo | null;
  onLogin: () => void;
  onSaveClientId: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [clientId, setClientIdInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const id = clientId.trim();
    if (!id) {
      setError("Paste your Client ID first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await props.onSaveClientId(id);
      setEditing(false);
      await props.onLogin();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const showSetup = !props.info?.clientIdSet || editing;
  const redirect = props.info?.redirectUri ?? "http://127.0.0.1:8431/callback";
  const configPath = props.info?.configPath ?? "…/spotagooey/client.yml";

  return (
    <div className="login-screen">
      <div className="login-hero">
        <div className="login-logo">♪</div>
        <h1>Spotagooey</h1>
        <p>Your library, beautifully.</p>
        {showSetup ? (
          <div className="setup-card">
            <ol className="setup-steps">
              <li>
                <div className="setup-step-head">
                  <span>Create a Spotify Developer app</span>
                  <button
                    className="ghost-btn"
                    onClick={() => openUrl("https://developer.spotify.com/dashboard")}
                  >
                    Open dashboard ↗
                  </button>
                </div>
                <p className="setup-note">
                  Add this as a Redirect URI in your app's settings:{" "}
                  <code>{redirect}</code>
                </p>
              </li>
              <li>
                <div className="setup-step-head">
                  <span>Paste your Client ID</span>
                </div>
                <input
                  className="search-input"
                  placeholder="e.g. d420a117a32841c2b3474932e49fb54b"
                  value={clientId}
                  onChange={(e) => setClientIdInput(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                  spellCheck={false}
                />
                <p className="setup-note">
                  Stored locally in <code>{configPath}</code> — never sent anywhere
                  except Spotify.
                </p>
              </li>
            </ol>
            {error && <p className="setup-error">{error}</p>}
            <button className="login-btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save and continue"}
            </button>
          </div>
        ) : (
          <>
            <button className="login-btn" onClick={props.onLogin}>
              Continue with Spotify
            </button>
            <button className="link-btn" onClick={() => setEditing(true)}>
              Change Client ID
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function HomeView(props: {
  shelves: Shelves;
  onAlbum: (id: string) => void;
  onPlaylist: (id: string) => void;
  onPlayAll: (uris: string[], context?: string) => void;
  onSearch: () => void;
}) {
  const { savedAlbums, playlists, savedTracks } = props.shelves;
  return (
    <div className="scroll-area">
      <header className="view-header">
        <h2>Home</h2>
        <button className="ghost-btn" onClick={props.onSearch}>
          Search
        </button>
      </header>

      <section>
        <div className="section-head">
          <h3>Recently added albums</h3>
        </div>
        <CardGrid items={savedAlbums.slice(0, 12)} onClick={props.onAlbum} playContext={(a) => props.onPlayAll([], a.uri)} />
      </section>

      <section>
        <div className="section-head">
          <h3>Playlists</h3>
        </div>
        <CardGrid items={playlists.slice(0, 12)} onClick={props.onPlaylist} playContext={(p) => props.onPlayAll([], p.uri)} />
      </section>

      <section>
        <div className="section-head">
          <h3>Saved songs</h3>
          <span className="muted">{savedTracks.length} tracks</span>
        </div>
        <div className="rows">
          {savedTracks.slice(0, 25).map((t, i) => (
            <TrackRow key={trackKey(t)} t={t} index={i} onPlay={() => props.onPlayAll([t.uri])} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CardGrid(props: {
  items: (Album | Playlist)[];
  onClick: (id: string) => void;
  playContext?: (item: Album | Playlist) => void;
}) {
  if (!props.items.length) return <p className="muted">Nothing here yet.</p>;
  return (
    <div className="card-grid">
      {props.items.map((item) => {
        const img = imageOf(item, 300);
        return (
          <div key={item.id} className="card" onClick={() => props.onClick(item.id)}>
            <div className="card-art">
              {img ? <img src={img} alt={item.name} loading="lazy" /> : <div className="card-art-placeholder">♪</div>}
              {props.playContext && (
                <button
                  className="card-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.playContext?.(item);
                  }}
                >
                  ▶
                </button>
              )}
            </div>
            <div className="card-title">{item.name}</div>
            <div className="card-subtitle">{("owner" in item ? item.owner.display_name : "Album") ?? "—"}</div>
          </div>
        );
      })}
    </div>
  );
}

function SearchView(props: {
  query: string;
  searching: boolean;
  categorySearching: boolean;
  activeCategory: SearchCategory | null;
  onQuery: (q: string) => void;
  results: SearchResults | null;
  categoryResults: SearchResults | null;
  onCategory: (category: SearchCategory | null, offset?: number) => void;
  onAlbum: (id: string) => void;
  onArtist: (id: string) => void;
  onPlaylist: (id: string) => void;
  onTrack: (uris: string[], context?: string) => void;
  onQueue: (uri: string) => void;
}) {
  const categories: { key: SearchCategory | null; label: string }[] = [
    { key: null, label: "All" },
    { key: "tracks", label: "Songs" },
    { key: "albums", label: "Albums" },
    { key: "artists", label: "Artists" },
    { key: "playlists", label: "Playlists" },
  ];
  const categoryPage = props.activeCategory && props.categoryResults
    ? props.categoryResults[props.activeCategory]
    : undefined;
  const categoryLabel = categories.find((item) => item.key === props.activeCategory)?.label ?? "Results";

  const renderTracks = (tracks: (Track | null)[]) => (
    <div className="rows">
      {tracks.map((track) =>
        track ? (
          <TrackRow
            key={trackKey(track)}
            t={track}
            onPlay={() => props.onTrack([track.uri])}
            onQueue={() => props.onQueue(track.uri)}
          />
        ) : null
      )}
    </div>
  );

  return (
    <div className="scroll-area">
      <header className="view-header">
        <input
          autoFocus
          className="search-input"
          value={props.query}
          onChange={(e) => props.onQuery(e.currentTarget.value)}
          placeholder="Search songs, albums, artists, playlists"
        />
      </header>
      {props.query.trim() && (
        <div className="search-filter-row" aria-label="Search categories">
          {categories.map((category) => (
            <button
              key={category.label}
              className={`search-filter-chip ${props.activeCategory === category.key ? "active" : ""}`}
              onClick={() => props.onCategory(category.key)}
              aria-pressed={props.activeCategory === category.key}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}
      {(props.searching && !props.activeCategory) || props.categorySearching ? <p className="muted search-status">Searching…</p> : null}

      {props.activeCategory && !props.categorySearching && props.categoryResults && (
        <div className="search-results search-category-results">
          <div className="search-category-head">
            <div>
              <h3>{categoryLabel}</h3>
              {categoryPage && <p className="muted">Showing results for “{props.query.trim()}”</p>}
            </div>
          </div>
          {props.activeCategory === "tracks" && props.categoryResults.tracks?.items.length
            ? renderTracks(props.categoryResults.tracks.items)
            : null}
          {props.activeCategory === "albums" && props.categoryResults.albums?.items.length ? (
            <CardGrid items={props.categoryResults.albums.items.filter((a): a is Album => Boolean(a))} onClick={props.onAlbum} />
          ) : null}
          {props.activeCategory === "artists" && props.categoryResults.artists?.items.length ? (
            <div className="artist-grid">
              {props.categoryResults.artists.items.map((artist) =>
                artist ? <ArtistTile key={artist.id} artist={artist} onClick={() => props.onArtist(artist.id)} /> : null
              )}
            </div>
          ) : null}
          {props.activeCategory === "playlists" && props.categoryResults.playlists?.items.length ? (
            <CardGrid items={props.categoryResults.playlists.items.filter((p): p is Playlist => Boolean(p))} onClick={props.onPlaylist} />
          ) : null}
          {categoryPage && !categoryPage.items.length && <p className="muted search-empty">No {categoryLabel.toLowerCase()} found.</p>}
          {categoryPage && (categoryPage.previous || categoryPage.next) && (
            <div className="search-pagination">
              <button
                className="ghost-btn"
                disabled={!categoryPage.previous}
                onClick={() => props.onCategory(props.activeCategory, Math.max(0, categoryPage.offset - categoryPage.limit))}
              >
                ← Previous
              </button>
              <span className="muted">{categoryPage.offset + 1}–{categoryPage.offset + categoryPage.items.length}</span>
              <button
                className="ghost-btn"
                disabled={!categoryPage.next}
                onClick={() => props.onCategory(props.activeCategory, categoryPage.offset + categoryPage.limit)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {!props.activeCategory && !props.searching && props.results && (
        <div className="search-results">
          {props.results.tracks?.items?.length ? (
            <section>
              <div className="section-head">
                <h3>Songs</h3>
                <button className="search-more" onClick={() => props.onCategory("tracks")}>See all</button>
              </div>
              {renderTracks(props.results.tracks.items)}
            </section>
          ) : null}
          {props.results.albums?.items?.length ? (
            <section>
              <div className="section-head">
                <h3>Albums</h3>
                <button className="search-more" onClick={() => props.onCategory("albums")}>See all</button>
              </div>
              <CardGrid items={props.results.albums.items.filter((a): a is Album => Boolean(a))} onClick={props.onAlbum} />
            </section>
          ) : null}
          {props.results.artists?.items?.length ? (
            <section>
              <div className="section-head">
                <h3>Artists</h3>
                <button className="search-more" onClick={() => props.onCategory("artists")}>See all</button>
              </div>
              <div className="artist-row">
                {props.results.artists.items.map(
                  (a) =>
                    a && (
                      <ArtistTile key={a.id} artist={a} onClick={() => props.onArtist(a.id)} />
                    )
                )}
              </div>
            </section>
          ) : null}
          {props.results.playlists?.items?.length ? (
            <section>
              <div className="section-head">
                <h3>Playlists</h3>
                <button className="search-more" onClick={() => props.onCategory("playlists")}>See all</button>
              </div>
              <CardGrid items={props.results.playlists.items.filter((p): p is Playlist => Boolean(p))} onClick={props.onPlaylist} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ArtistTile(props: { artist: Artist; onClick: () => void }) {
  const img = imageOf(props.artist, 200);
  return (
    <div className="artist-tile" onClick={props.onClick}>
      <div className="artist-art">{img ? <img src={img} alt={props.artist.name} /> : <div className="card-art-placeholder">♪</div>}</div>
      <div className="card-title">{props.artist.name}</div>
      <div className="card-subtitle">Artist</div>
    </div>
  );
}

function LibraryView(props: { shelves: Shelves; onAlbum: (id: string) => void; onPlaylist: (id: string) => void }) {
  return (
    <div className="scroll-area">
      <header className="view-header">
        <h2>Library</h2>
      </header>
      <section>
        <h3>Albums</h3>
        {props.shelves.savedAlbums.length ? (
          <CardGrid items={props.shelves.savedAlbums} onClick={props.onAlbum} />
        ) : (
          <p className="muted">No saved albums.</p>
        )}
      </section>
      <section>
        <h3>Playlists</h3>
        {props.shelves.playlists.length ? (
          <CardGrid items={props.shelves.playlists} onClick={props.onPlaylist} />
        ) : (
          <p className="muted">No playlists yet.</p>
        )}
      </section>
    </div>
  );
}

function TrackListView(props: {
  data: TrackListData;
  onBack: () => void;
  onPlayAll: (uris: string[], context?: string) => void;
  onQueue: (uri: string) => void;
}) {
  const { data } = props;
  return (
    <div className="scroll-area">
      <header className="entity-header">
        {data.artwork ? <img className="entity-art" src={data.artwork} alt={data.title} /> : <div className="entity-art placeholder">♪</div>}
        <div className="entity-meta">
          <button className="back-btn" onClick={props.onBack}>
            ← Back
          </button>
          <h1>{data.title}</h1>
          <p className="muted">{data.subtitle}</p>
          <button
            className="play-big"
            onClick={() => props.onPlayAll([], data.playUri)}
          >
            ▶ Play
          </button>
        </div>
      </header>
      <div className="rows">
        {data.tracks.map((t, i) => (
          <TrackRow key={trackKey(t)} t={t} index={i} onPlay={() => props.onPlayAll([t.uri])} onQueue={() => props.onQueue(t.uri)} />
        ))}
      </div>
    </div>
  );
}

function TrackRow(props: { t: Track; index?: number; onPlay: () => void; onQueue?: (uri: string) => void }) {
  const { t } = props;
  const img = imageOf(t.album, 60);
  const artists = (t.artists ?? []).map((a) => a.name).join(", ");
  return (
    <div className="track-row" onClick={props.onPlay} title={t.name}>
      <span className="track-index">{props.index !== undefined ? props.index + 1 : ""}</span>
      {img ? <img className="track-art" src={img} alt="" loading="lazy" /> : <div className="track-art placeholder">♪</div>}
      <div className="track-main">
        <div className="track-name">{t.name}</div>
        <div className="track-artists">{artists}</div>
      </div>
      <div className="track-album">{t.album?.name ?? ""}</div>
      <div className="track-duration">{msToTime(t.duration_ms ?? 0)}</div>
      {props.onQueue && (
        <button
          className="track-queue"
          onClick={(e) => {
            e.stopPropagation();
            props.onQueue?.(t.uri);
          }}
          title="Add to queue"
        >
          +
        </button>
      )}
    </div>
  );
}

type PlayerIconName =
  | "play"
  | "pause"
  | "previous"
  | "next"
  | "shuffle"
  | "repeat"
  | "repeat-one"
  | "lyrics"
  | "fullscreen"
  | "devices"
  | "close";

function PlayerIcon(props: { name: PlayerIconName; size?: number }) {
  const size = props.size ?? 19;
  const content = (() => {
    switch (props.name) {
      case "play":
        return <path d="M8 5.5 18 12 8 18.5Z" fill="currentColor" stroke="none" />;
      case "pause":
        return <><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none" /></>;
      case "previous":
        return <><path d="M6 5v14" /><path d="m18 6-9 6 9 6Z" /></>;
      case "next":
        return <><path d="M18 5v14" /><path d="m6 6 9 6-9 6Z" /></>;
      case "shuffle":
        return <><path d="M4 7h2.2c4.6 0 6.1 10 10.6 10H20" /><path d="m17 14 3 3-3 3" /><path d="M4 17h2.2c1.5 0 2.7-1 3.8-2.5M14 8.5c.9-.9 1.8-1.5 2.8-1.5H20" /><path d="m17 4 3 3-3 3" /></>;
      case "repeat":
      case "repeat-one":
        return <><path d="M17 5H8a4 4 0 0 0-4 4v1" /><path d="m14 2 3 3-3 3" /><path d="M7 19h9a4 4 0 0 0 4-4v-1" /><path d="m10 22-3-3 3-3" />{props.name === "repeat-one" && <path d="M11 9h1v6" />}</>;
      case "lyrics":
        return <><path d="M4 5h16v12H9l-5 3Z" /><path d="M8 9h3v3H8zM14 9h3v3h-3z" /></>;
      case "fullscreen":
        return <><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" /></>;
      case "devices":
        return <><path d="M5 18h14" /><path d="m9 18 3-5 3 5" /><path d="M8.5 10.5a5 5 0 0 1 7 0" /><path d="M6 8a8.5 8.5 0 0 1 12 0" /></>;
      case "close":
        return <><path d="m6 6 12 12M18 6 6 18" /></>;
    }
  })();
  return (
    <svg className="player-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {content}
    </svg>
  );
}

function NowPlayingBar(props: {
  track: CurrentTrack | null;
  player: PlaybackState | null;
  restored?: boolean;
  progress: number;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onSeek: (ms: number) => void;
  onVolume: (v: number) => void;
  onDevices: () => void;
  onLyrics: () => void;
  lyricsOpen: boolean;
  onFullscreen: () => void;
}) {
  const { track, player } = props;
  return (
    <footer className="now-playing">
      <div className="np-track">
        <button className="np-art-button" onClick={props.onFullscreen} disabled={!track} title="Open full player">
          {track?.image ? <img className="np-art" src={track.image} alt="" /> : <div className="np-art placeholder">♪</div>}
        </button>
        <div className="np-meta">
          <div className="np-name">{track?.name ?? "Nothing playing"}</div>
          <div className="np-artists">{(track?.artists ?? []).map((a) => a.name).join(", ") || "—"}{props.restored && <span className="restored-label"> · Last session</span>}</div>
        </div>
      </div>
      <div className="np-center">
        <PlayerTransport player={player} onToggle={props.onToggle} onNext={props.onNext} onPrev={props.onPrev} onShuffle={props.onShuffle} onRepeat={props.onRepeat} />
        <ProgressSlider progress={props.progress} duration={track?.duration ?? 0} onSeek={props.onSeek} />
      </div>
      <div className="np-right">
        <button className="ctrl" onClick={props.onLyrics} title="Lyrics" aria-label="Lyrics" data-active={props.lyricsOpen} disabled={!track}>
          <PlayerIcon name="lyrics" />
        </button>
        <button className="ctrl" onClick={props.onFullscreen} title="Open full player" aria-label="Open full player" disabled={!track}>
          <PlayerIcon name="fullscreen" />
        </button>
        <button className="ctrl" onClick={props.onDevices} title="Devices" aria-label="Devices">
          <PlayerIcon name="devices" />
        </button>
        <input
          className="slider slim"
          type="range"
          min={0}
          max={100}
          value={player?.device?.volume_percent ?? 50}
          style={{ "--fill": `${player?.device?.volume_percent ?? 50}%` } as CSSProperties}
          onChange={(e) => props.onVolume(Number(e.currentTarget.value))}
        />
      </div>
    </footer>
  );
}

function PlayerTransport(props: {
  player: PlaybackState | null;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
}) {
  return (
    <div className="np-controls">
      <button className="ctrl" onClick={props.onShuffle} title="Shuffle" aria-label="Shuffle" data-active={props.player?.shuffle_state}><PlayerIcon name="shuffle" /></button>
      <button className="ctrl" onClick={props.onPrev} title="Previous" aria-label="Previous"><PlayerIcon name="previous" /></button>
      <button className="ctrl primary" onClick={props.onToggle} title="Play / Pause" aria-label={props.player?.is_playing ? "Pause" : "Play"}>
        <PlayerIcon name={props.player?.is_playing ? "pause" : "play"} size={21} />
      </button>
      <button className="ctrl" onClick={props.onNext} title="Next" aria-label="Next"><PlayerIcon name="next" /></button>
      <button className="ctrl" onClick={props.onRepeat} title="Repeat" aria-label="Repeat" data-active={props.player?.repeat_state !== "off"}>
        <PlayerIcon name={props.player?.repeat_state === "track" ? "repeat-one" : "repeat"} />
      </button>
    </div>
  );
}

function ProgressSlider(props: { progress: number; duration: number; onSeek: (ms: number) => void }) {
  const progress = Math.min(props.duration || Number.MAX_SAFE_INTEGER, Math.max(0, props.progress));
  const pct = props.duration ? Math.min(100, (progress / props.duration) * 100) : 0;
  return (
    <div className="np-progress">
      <span className="time">{msToTime(progress)}</span>
      <input
        className="slider"
        type="range"
        min={0}
        max={Math.max(1, props.duration)}
        value={progress}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        onChange={(event) => props.onSeek(Number(event.currentTarget.value))}
      />
      <span className="time">{msToTime(props.duration)}</span>
    </div>
  );
}

export function LyricsPanel(props: {
  document: LyricsDocument | null;
  status: LyricsStatus;
  error: string | null;
  progress: number;
  onSeek: (ms: number) => void;
  onRetry: () => void;
  onClose?: () => void;
  variant?: "sidebar" | "full";
}) {
  const active = activeLyricIndex(props.document, props.progress);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const followAfter = useRef(0);
  const activeRef = useRef(active);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeRef.current = active;

  useEffect(() => {
    if (active < 0 || performance.now() < followAfter.current) return;
    lineRefs.current[active]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active]);

  const suspendFollow = () => {
    followAfter.current = performance.now() + 5000;
    if (followTimer.current) clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => {
      followAfter.current = 0;
      const line = lineRefs.current[activeRef.current];
      line?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 5000);
  };

  useEffect(() => () => {
    if (followTimer.current) clearTimeout(followTimer.current);
  }, []);

  const sourceName = props.document?.source === "lrclib" ? "LRCLIB" : "Genius";
  return (
    <aside className={`lyrics-panel ${props.variant === "full" ? "lyrics-panel-full" : "lyrics-sidebar"}`}>
      <header className="lyrics-header">
        <div>
          <h2>Lyrics</h2>
          {props.document?.kind === "plain" && <span className="lyrics-badge">Unsynchronized</span>}
        </div>
        {props.onClose && <button className="ctrl" onClick={props.onClose} title="Close lyrics" aria-label="Close lyrics"><PlayerIcon name="close" /></button>}
      </header>
      <div className="lyrics-scroll" onWheel={suspendFollow} onTouchMove={suspendFollow}>
        {props.status === "loading" && <div className="lyrics-message"><span className="lyrics-loader" />Finding lyrics…</div>}
        {props.status === "error" && (
          <div className="lyrics-message">
            <strong>Lyrics could not be loaded.</strong>
            <span>{props.error}</span>
            <button className="ghost-btn" onClick={props.onRetry}>Try again</button>
          </div>
        )}
        {props.status === "unavailable" && <div className="lyrics-message"><strong>No lyrics found.</strong><span>This track may be instrumental or unavailable.</span></div>}
        {props.status === "ready" && props.document && (
          <div className={`lyrics-lines ${props.document.kind}`}>
            {props.document.lines.map((line, index) => (
              <button
                className="lyric-line"
                data-active={index === active}
                disabled={line.startMs == null}
                key={`${line.startMs ?? "plain"}-${index}`}
                ref={(element) => { lineRefs.current[index] = element; }}
                onClick={() => {
                  if (line.startMs == null) return;
                  followAfter.current = 0;
                  props.onSeek(line.startMs);
                }}
              >
                {line.text || "♪"}
              </button>
            ))}
          </div>
        )}
      </div>
      {props.document && (
        <button className="lyrics-source" onClick={() => void openUrl(props.document!.sourceUrl).catch(() => undefined)}>
          Lyrics from {sourceName} ↗
        </button>
      )}
    </aside>
  );
}

export function FullPlayer(props: {
  track: CurrentTrack | null;
  player: PlaybackState | null;
  restored?: boolean;
  progress: number;
  document: LyricsDocument | null;
  lyricsStatus: LyricsStatus;
  lyricsError: string | null;
  onClose: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onSeek: (ms: number) => void;
  onVolume: (value: number) => void;
  onDevices: () => void;
  onRetry: () => void;
}) {
  const [lyricsOpen, setLyricsOpen] = useState(true);

  useEffect(() => {
    setLyricsOpen(true);
  }, [props.track?.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose]);

  const hasLyrics = props.lyricsStatus === "ready" && Boolean(props.document);
  const showLyrics = lyricsOpen && hasLyrics;
  const backgroundStyle = props.track?.image
    ? ({ "--player-art": `url("${props.track.image.split('"').join('%22')}")` } as CSSProperties)
    : undefined;
  return (
    <section className={`full-player ${showLyrics ? "with-lyrics" : "without-lyrics"}`} style={backgroundStyle} role="dialog" aria-modal="true" aria-label="Now playing">
      <div className="full-player-backdrop" />
      <button className="full-close" onClick={props.onClose} title="Close full player" aria-label="Close full player" autoFocus><PlayerIcon name="close" size={24} /></button>
      <div className="full-player-content">
        <div className="full-track-column">
          {props.track?.image ? <img className="full-art" src={props.track.image} alt={`${props.track.album?.name ?? props.track.name} artwork`} /> : <div className="full-art placeholder">♪</div>}
          <div className="full-meta">
            <div><h1>{props.track?.name ?? "Nothing playing"}</h1><p>{props.track?.artists.map((artist) => artist.name).join(", ") || "—"}{props.track?.album?.name ? ` — ${props.track.album.name}` : ""}{props.restored && <span className="restored-label"> · Last session</span>}</p></div>
          </div>
          <ProgressSlider progress={props.progress} duration={props.track?.duration ?? 0} onSeek={props.onSeek} />
          <PlayerTransport player={props.player} onToggle={props.onToggle} onNext={props.onNext} onPrev={props.onPrev} onShuffle={props.onShuffle} onRepeat={props.onRepeat} />
          <div className="full-volume">
            <button className="ctrl" onClick={props.onDevices} title="Devices" aria-label="Devices"><PlayerIcon name="devices" /></button>
            <input className="slider" type="range" min={0} max={100} value={props.player?.device?.volume_percent ?? 50} style={{ "--fill": `${props.player?.device?.volume_percent ?? 50}%` } as CSSProperties} onChange={(event) => props.onVolume(Number(event.currentTarget.value))} />
            <button
              className="ctrl full-lyrics-toggle"
              onClick={() => setLyricsOpen((open) => !open)}
              title={lyricsOpen ? "Hide lyrics" : "Show lyrics"}
              aria-label={lyricsOpen ? "Hide lyrics" : "Show lyrics"}
              aria-pressed={lyricsOpen}
              data-active={lyricsOpen}
            >
              <PlayerIcon name="lyrics" />
            </button>
          </div>
          {lyricsOpen && !hasLyrics && props.lyricsStatus === "loading" && <p className="full-lyrics-status">Finding lyrics…</p>}
          {lyricsOpen && !hasLyrics && props.lyricsStatus === "error" && <button className="full-lyrics-status" onClick={props.onRetry}>Lyrics unavailable · Retry</button>}
        </div>
        {showLyrics && (
          <LyricsPanel document={props.document} status={props.lyricsStatus} error={props.lyricsError} progress={props.progress} onSeek={props.onSeek} onRetry={props.onRetry} variant="full" />
        )}
      </div>
    </section>
  );
}

function DeviceSheet(props: { devices: Device[]; activeId: string | null; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h3>Choose a device</h3>
          <button className="ghost-btn" onClick={props.onClose}>
            Close
          </button>
        </header>
        <div className="sheet-list">
          {props.devices.length === 0 && <p className="muted">No devices found. Open Spotify on another device.</p>}
          {props.devices.map((d) => (
            <button key={d.id ?? d.name} className={"device-row" + (d.is_active ? " active" : "")} onClick={() => d.id && props.onPick(d.id)}>
              <span className="device-name">{d.name}</span>
              <span className="device-type">{d.type}</span>
              {d.is_active && <span className="device-active">Active</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
