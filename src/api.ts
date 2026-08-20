import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  clientIdSet: boolean;
  configPath: string;
  redirectUri: string;
}

export interface LoginResult {
  displayName: string | null;
  id: string;
  email: string | null;
  imageUrl: string | null;
  product: string | null;
}

export interface NativePlaybackInfo {
  state: "stopped" | "starting" | "ready" | "disconnected" | "failed";
  deviceName: string;
  deviceId: string | null;
  error: string | null;
}

export interface Image {
  url: string;
  height: number | null;
  width: number | null;
}

export interface Artist {
  id: string;
  name: string;
  images: Image[];
  uri: string;
  genres?: string[];
  followers?: { total: number };
}

export interface Album {
  id: string;
  name: string;
  artists: Artist[];
  images: Image[];
  uri: string;
  release_date?: string;
  total_tracks?: number;
  tracks?: { items: Track[] };
}

export interface Track {
  id: string;
  name: string;
  artists: Artist[];
  album: Album;
  duration_ms: number;
  uri: string;
  explicit?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  images: Image[] | null;
  uri: string;
  owner: { display_name?: string; id: string };
  tracks?: { total: number };
}

export interface PlaylistTrack {
  added_at: string | null;
  track: Track | Record<string, unknown>;
  is_local: boolean;
}

export interface SavedTrack {
  added_at: string;
  track: Track;
}

export interface SavedAlbum {
  added_at: string;
  album: Album;
}

export interface Page<T> {
  href: string;
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
  items: T[];
}

export interface SearchResults {
  tracks?: Page<Track | null>;
  albums?: Page<Album | null>;
  artists?: Page<Artist | null>;
  playlists?: Page<Playlist | null>;
}

export type SearchCategory = "tracks" | "albums" | "artists" | "playlists";

export type PlaybackItem = Track | Record<string, unknown>;

export interface Device {
  id: string | null;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
}

export interface PlaybackState {
  device: Device;
  repeat_state: "off" | "track" | "context";
  shuffle_state: boolean;
  context: { uri: string; type: string } | null;
  progress_ms: number | null;
  timestamp?: number;
  is_playing: boolean;
  item: PlaybackItem | null;
  actions: Record<string, boolean>;
}

export interface LyricsLine {
  startMs: number | null;
  text: string;
}

export interface LyricsDocument {
  trackId: string;
  source: "lrclib" | "genius";
  kind: "synced" | "plain";
  lines: LyricsLine[];
  sourceUrl: string;
}

export interface LyricsRequest {
  trackId: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
}

export async function appInfo(): Promise<AppInfo> {
  return invoke("app_info");
}

export async function session(): Promise<LoginResult | null> {
  return invoke("session");
}

export async function login(): Promise<LoginResult> {
  return invoke("login");
}

export async function logout(): Promise<void> {
  return invoke("logout");
}

export async function startNativePlayback(): Promise<NativePlaybackInfo> {
  return invoke("start_native_playback");
}

export async function nativePlaybackStatus(): Promise<NativePlaybackInfo> {
  return invoke("native_playback_status");
}

export async function setClientId(clientId: string): Promise<void> {
  return invoke("set_client_id", { clientId });
}

export async function search(query: string): Promise<SearchResults> {
  return invoke("search", { query });
}

export async function searchCategory(
  query: string,
  category: SearchCategory,
  offset = 0
): Promise<SearchResults> {
  return invoke("search_category", { query, category, offset });
}

export async function savedTracks(): Promise<Page<SavedTrack>> {
  return invoke("saved_tracks");
}

export async function savedAlbums(): Promise<Page<SavedAlbum>> {
  return invoke("saved_albums");
}

export async function playlists(): Promise<Page<Playlist>> {
  return invoke("playlists");
}

export async function playlistItems(id: string): Promise<Page<PlaylistTrack>> {
  return invoke("playlist_items", { id });
}

export async function album(id: string): Promise<Album> {
  return invoke("album", { id });
}

export async function artistTopTracks(id: string): Promise<{ tracks: (Track | null)[] }> {
  return invoke("artist_top_tracks", { id });
}

export async function playbackState(): Promise<PlaybackState | null> {
  return invoke("playback_state");
}

export async function devices(): Promise<{ devices: Device[] }> {
  return invoke("devices");
}

export async function play(args: {
  contextUri?: string;
  uris?: string[];
  positionMs?: number;
}): Promise<void> {
  return invoke("play", { contextUri: args.contextUri ?? null, uris: args.uris ?? null, positionMs: args.positionMs ?? null });
}

export async function pause(): Promise<void> {
  return invoke("pause");
}

export async function resume(): Promise<void> {
  return invoke("resume");
}

export async function skipNext(): Promise<void> {
  return invoke("skip_next");
}

export async function skipPrevious(): Promise<void> {
  return invoke("skip_previous");
}

export async function seek(positionMs: number): Promise<void> {
  return invoke("seek", { positionMs });
}

export async function setShuffle(shuffle: boolean): Promise<void> {
  return invoke("set_shuffle", { shuffle });
}

export async function setRepeat(mode: "off" | "context" | "track"): Promise<void> {
  return invoke("set_repeat", { mode });
}

export async function setVolume(percent: number): Promise<void> {
  return invoke("set_volume", { percent });
}

export async function transferPlayback(deviceId: string): Promise<void> {
  return invoke("transfer_playback", { deviceId });
}

export async function addToQueue(uri: string): Promise<void> {
  return invoke("add_to_queue", { uri });
}

export async function getLyrics(request: LyricsRequest): Promise<LyricsDocument | null> {
  return invoke("get_lyrics", { request });
}

export function imageOf(item: { images?: Image[] | null } | null, size: number): string | null {
  const imgs = item?.images?.length ? item.images : [];
  if (!imgs.length) return null;
  const sorted = [...imgs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const pick = sorted.find((i) => (i.width ?? 0) >= size) ?? sorted[sorted.length - 1];
  return pick.url;
}

export function msToTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function trackKey(t: Track | null | undefined): string {
  if (!t) return "";
  return t.id ?? t.uri ?? t.name;
}
