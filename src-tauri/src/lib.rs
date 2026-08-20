#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod config;
mod lyrics;
mod native_playback;

use std::{borrow::Cow, collections::HashSet, time::Duration};

use http::Method;
use serde::Serialize;
use serde_json::Value;
use spotify_web_api::{
    api::{
        albums::{GetAlbum, GetUserSavedAlbums},
        artists::{GetArtist, GetArtistTopTracks},
        ignore, player::{AddItemToPlaybackQueue, GetAvailableDevices, GetPlaybackState},
        playlists::{GetCurrentUserPlaylists, GetPlaylist, GetPlaylistItems},
        raw, Endpoint, QueryParams,
        tracks::{GetTrack, GetUserSavedTracks},
        users::{GetCurrentUserProfile, GetUserTopItems},
        AsyncQuery as _,
    },
    model::{
        id::{ContextType, TrackId},
        player::RepeatState,
        SearchType, TimeRange, TopItemType,
    },
    AsyncSpotifyPKCE,
};

#[derive(Debug, Clone)]
struct SearchPage {
    query: String,
    search_types: Vec<SearchType>,
    limit: u8,
    offset: u32,
}

impl Endpoint for SearchPage {
    fn method(&self) -> Method {
        Method::GET
    }

    fn endpoint(&self) -> Cow<'static, str> {
        "search".into()
    }

    fn parameters(&self) -> QueryParams<'_> {
        let mut params = QueryParams::default();
        let query = format!(
            "{}",
            spotify_web_api::api::common::path_escaped(&self.query)
        );
        let search_types = self
            .search_types
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        params.push("q", &query);
        params.push("type", &search_types);
        params.push("limit", &self.limit);
        params.push("offset", &self.offset);
        params
    }
}

pub const REDIRECT_PORT: u16 = config::DEFAULT_REDIRECT_PORT;

struct SpotifyState {
    client: tokio::sync::Mutex<Option<std::sync::Arc<AsyncSpotifyPKCE>>>,
    config: tokio::sync::Mutex<config::Config>,
    native: tokio::sync::Mutex<NativePlaybackState>,
    selected_device: tokio::sync::Mutex<Option<String>>,
    lyrics: lyrics::LyricsService,
}

struct NativePlaybackState {
    generation: u64,
    state: String,
    error: Option<String>,
    player: Option<native_playback::NativePlayer>,
}

impl Default for NativePlaybackState {
    fn default() -> Self {
        Self {
            generation: 0,
            state: "stopped".to_string(),
            error: None,
            player: None,
        }
    }
}

impl NativePlaybackState {
    fn info(&self) -> native_playback::NativePlaybackInfo {
        self.player.as_ref().map_or_else(
            || native_playback::NativePlaybackInfo {
                state: self.state.clone(),
                device_name: native_playback::DEVICE_NAME.to_string(),
                device_id: None,
                error: self.error.clone(),
            },
            native_playback::NativePlayer::info,
        )
    }
}

fn redirect_uri() -> String {
    config::load()
        .redirect_uri
        .trim()
        .to_string()
}

fn client_id() -> Result<String, String> {
    config::resolved_client_id().ok_or_else(|| {
        "No Spotify Client ID configured. Open the app setup, create a Spotify Developer app, and paste its Client ID."
            .to_string()
    })
}

macro_rules! api_err {
    ($action:literal) => {
        |e| format!("{}: {e}", $action)
    };
}

macro_rules! query_value {
    ($client:expr, $endpoint:expr, $action:literal) => {{
        let bytes = raw($endpoint)
            .query_async($client)
            .await
            .map_err(api_err!($action))?;
        if bytes.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_slice(&bytes)
                .map_err(|e| format!("failed to decode Spotify response: {e}"))
        }
    }};
}

async fn must_client(
    state: &tauri::State<'_, SpotifyState>,
) -> Result<std::sync::Arc<AsyncSpotifyPKCE>, String> {
    let guard = state.client.lock().await;
    match guard.as_ref() {
        Some(c) => Ok(c.clone()),
        None => Err("not logged in. Run login() first.".to_string()),
    }
}

fn parse_context_type(uri: &str) -> Result<ContextType, String> {
    let parts: Vec<&str> = uri.split(':').collect();
    if parts.len() < 3 {
        return Err(format!("invalid context URI: {uri}"));
    }
    let id = parts[2];
    match parts[1] {
        "album" => Ok(ContextType::Album(
            spotify_web_api::model::id::AlbumId::from_id(id).map_err(|e| e.to_string())?,
        )),
        "artist" => Ok(ContextType::Artist(
            spotify_web_api::model::id::ArtistId::from_id(id).map_err(|e| e.to_string())?,
        )),
        "playlist" => Ok(ContextType::Playlist(
            spotify_web_api::model::id::PlaylistId::from_id(id).map_err(|e| e.to_string())?,
        )),
        "show" => Ok(ContextType::Show(
            spotify_web_api::model::id::ShowId::from_id(id).map_err(|e| e.to_string())?,
        )),
        other => Err(format!("unsupported context type: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

#[tauri::command]
async fn login(state: tauri::State<'_, SpotifyState>) -> Result<auth::LoginResult, String> {
    let client_id = client_id()?;
    let redirect_uri = redirect_uri();
    let port = config::load().port;
    let code_rx = auth::spawn_callback_server(port)?;

    let mut client = auth::build_client(&client_id, &redirect_uri)?;
    let auth_url = client.user_authorization_url();

    webbrowser::open(&auth_url).map_err(|e| format!("failed to open browser: {e}"))?;

    let callback = tokio::time::timeout(Duration::from_secs(300), code_rx)
        .await
        .map_err(|_| "timed out waiting for Spotify authorization (5 min)".to_string())?
        .map_err(|_| "callback server failed".to_string())?;

    let full_url = format!("http://127.0.0.1:{port}{callback}");
    auth::complete_login(&client, &full_url).await?;

    let user: spotify_web_api::model::users::CurrentUserProfile =
        GetCurrentUserProfile.query_async(&client).await.map_err(api_err!("failed to fetch user profile"))?;

    let mut state_cfg = state.config.lock().await;
    let mut cfg = state_cfg.clone();
    cfg.token = auth::token(&client);
    config::save(&cfg)?;
    *state_cfg = cfg;

    *state.client.lock().await = Some(std::sync::Arc::new(client));
    Ok(auth::LoginResult::from(&user))
}

#[tauri::command]
async fn logout(state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    let native = {
        let mut native = state.native.lock().await;
        native.generation = native.generation.wrapping_add(1);
        native.state = "stopped".to_string();
        native.error = None;
        native.player.take()
    };
    if let Some(player) = native {
        player.shutdown();
    }
    *state.selected_device.lock().await = None;
    *state.client.lock().await = None;
    let mut state_cfg = state.config.lock().await;
    let mut cfg = state_cfg.clone();
    cfg.token = None;
    config::save(&cfg)?;
    *state_cfg = cfg;
    Ok(())
}

#[tauri::command]
async fn native_playback_status(
    state: tauri::State<'_, SpotifyState>,
) -> Result<native_playback::NativePlaybackInfo, String> {
    Ok(state.native.lock().await.info())
}

#[tauri::command]
async fn start_native_playback(
    state: tauri::State<'_, SpotifyState>,
) -> Result<native_playback::NativePlaybackInfo, String> {
    let _client = must_client(&state).await?;

    let generation = {
        let mut native = state.native.lock().await;
        if native.player.is_some() || native.state == "starting" {
            return Ok(native.info());
        }
        native.generation = native.generation.wrapping_add(1);
        native.state = "starting".to_string();
        native.error = None;
        native.generation
    };

    let result = native_playback::NativePlayer::start().await;
    let mut native = state.native.lock().await;
    if native.generation != generation {
        if let Ok(player) = result {
            player.shutdown();
        }
        return Ok(native.info());
    }

    match result {
        Ok(player) => {
            let device_id = player.info().device_id;
            native.state = "ready".to_string();
            native.error = None;
            native.player = Some(player);
            let mut selected = state.selected_device.lock().await;
            if selected.is_none() {
                *selected = device_id;
            }
        }
        Err(error) => {
            native.state = "failed".to_string();
            native.error = Some(error);
            native.player = None;
        }
    }
    Ok(native.info())
}

#[tauri::command]
async fn set_client_id(client_id: String, state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    let trimmed = client_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("Client ID cannot be empty".to_string());
    }
    let mut state_cfg = state.config.lock().await;
    let mut cfg = state_cfg.clone();
    cfg.client_id = Some(trimmed);
    config::save(&cfg)?;
    *state_cfg = cfg;
    Ok(())
}

fn restore_session_from_config(
    token: Option<spotify_web_api::model::token::Token>,
) -> Result<Option<std::sync::Arc<AsyncSpotifyPKCE>>, String> {
    let Some(token) = token else {
        return Ok(None);
    };
    let client = auth::build_client(&client_id()?, &redirect_uri())?.with_token(token);
    Ok(Some(std::sync::Arc::new(client)))
}

#[tauri::command]
async fn session(state: tauri::State<'_, SpotifyState>) -> Result<Option<auth::LoginResult>, String> {
    let mut guard = state.client.lock().await;
    if guard.is_none() {
        let token = {
            let cfg = state.config.lock().await;
            cfg.token.clone()
        };
        match restore_session_from_config(token) {
            Ok(Some(client)) => *guard = Some(client),
            Ok(None) => {}
            Err(e) => {
                let mut cfg = state.config.lock().await;
                let mut c = cfg.clone();
                c.token = None;
                let _ = config::save(&c);
                *cfg = c;
                return Err(format!("saved session is no longer valid: {e}"));
            }
        }
    }

    let Some(client) = guard.as_ref() else {
        return Ok(None);
    };

    let user: spotify_web_api::model::users::CurrentUserProfile =
        GetCurrentUserProfile.query_async(client.as_ref()).await.map_err(api_err!("failed to fetch user profile"))?;
    Ok(Some(auth::LoginResult::from(&user)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    client_id_set: bool,
    config_path: String,
    redirect_uri: String,
}

#[tauri::command]
fn app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        client_id_set: config::resolved_client_id().is_some(),
        config_path: config::config_path()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        redirect_uri: redirect_uri(),
    })
}

// ---------------------------------------------------------------------------
// Library & Search
// ---------------------------------------------------------------------------

#[tauri::command]
async fn search(state: tauri::State<'_, SpotifyState>, query: String) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("search query cannot be empty".to_string());
    }

    let client = must_client(&state).await?;
    let broad_search = search_value(
        client.as_ref(),
        SearchPage {
            query: query.to_string(),
            search_types: vec![
                SearchType::Track,
                SearchType::Album,
                SearchType::Artist,
                SearchType::Playlist,
            ],
            limit: 10,
            offset: 0,
        },
    );
    let artist_search = search_value(
        client.as_ref(),
        SearchPage {
            query: artist_field_query(query),
            search_types: vec![SearchType::Artist],
            limit: 10,
            offset: 0,
        },
    );

    let (results, focused_artists) = tokio::join!(broad_search, artist_search);
    let mut results = results?;
    if let Ok(focused_artists) = focused_artists {
        merge_focused_artists(&mut results, focused_artists, query, 10);
    }
    Ok(results)
}

#[tauri::command]
async fn search_category(
    state: tauri::State<'_, SpotifyState>,
    query: String,
    category: String,
    offset: u32,
) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("search query cannot be empty".to_string());
    }

    let search_type = match category.as_str() {
        "tracks" => SearchType::Track,
        "albums" => SearchType::Album,
        "artists" => SearchType::Artist,
        "playlists" => SearchType::Playlist,
        other => return Err(format!("unsupported search category: {other}")),
    };
    let is_artist = search_type == SearchType::Artist;
    let offset = offset.min(1_000);
    let client = must_client(&state).await?;
    let category_search = search_value(
        client.as_ref(),
        SearchPage {
            query: query.to_string(),
            search_types: vec![search_type],
            limit: 10,
            offset,
        },
    );
    if is_artist && offset == 0 {
        let focused_search = search_value(
            client.as_ref(),
            SearchPage {
                query: artist_field_query(query),
                search_types: vec![SearchType::Artist],
                limit: 10,
                offset: 0,
            },
        );
        let (results, focused_artists) = tokio::join!(category_search, focused_search);
        let mut results = results?;
        if let Ok(focused_artists) = focused_artists {
            merge_focused_artists(&mut results, focused_artists, query, 10);
        }
        Ok(results)
    } else {
        category_search.await
    }
}

async fn search_value(client: &AsyncSpotifyPKCE, endpoint: SearchPage) -> Result<Value, String> {
    let bytes = raw(endpoint)
        .query_async(client)
        .await
        .map_err(|e| format!("search failed: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("failed to decode Spotify search response: {e}"))
}

fn normalize_search_name(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn artist_field_query(query: &str) -> String {
    format!("artist:\"{}\"", query.replace('"', "\\\""))
}

fn merge_focused_artists(base: &mut Value, focused: Value, query: &str, limit: usize) {
    let Some(base_artists) = base
        .get_mut("artists")
        .and_then(|artists| artists.get_mut("items"))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let focused_artists = focused
        .get("artists")
        .and_then(|artists| artists.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let normalized_query = normalize_search_name(query);
    let mut combined = focused_artists;
    combined.append(base_artists);
    combined.sort_by_key(|artist| {
        let is_exact = artist
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| normalize_search_name(name) == normalized_query);
        !is_exact
    });

    let mut seen = HashSet::new();
    combined.retain(|artist| {
        artist
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| seen.insert(id.to_string()))
    });
    combined.truncate(limit);
    *base_artists = combined;
}

#[tauri::command]
async fn saved_tracks(state: tauri::State<'_, SpotifyState>) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetUserSavedTracks::default(), "failed to load saved tracks")
}

#[tauri::command]
async fn saved_albums(state: tauri::State<'_, SpotifyState>) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetUserSavedAlbums::default(), "failed to load saved albums")
}

#[tauri::command]
async fn playlists(state: tauri::State<'_, SpotifyState>) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetCurrentUserPlaylists, "failed to load playlists")
}

#[tauri::command]
async fn playlist(state: tauri::State<'_, SpotifyState>, id: String) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetPlaylist::from(id), "failed to load playlist")
}

#[tauri::command]
async fn playlist_items(state: tauri::State<'_, SpotifyState>, id: String) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetPlaylistItems::from(id), "failed to load playlist items")
}

#[tauri::command]
async fn album(state: tauri::State<'_, SpotifyState>, id: String) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetAlbum::from(id), "failed to load album")
}

#[tauri::command]
async fn artist(state: tauri::State<'_, SpotifyState>, id: String) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetArtist::from(id), "failed to load artist")
}

#[tauri::command]
async fn artist_top_tracks(state: tauri::State<'_, SpotifyState>, id: String) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetArtistTopTracks::from(id), "failed to load artist top tracks")
}

#[tauri::command]
async fn track(state: tauri::State<'_, SpotifyState>, id: String) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetTrack::from(id), "failed to load track")
}

#[tauri::command]
async fn top_items(
    state: tauri::State<'_, SpotifyState>,
    kind: String,
    time_range: Option<String>,
) -> Result<Value, String> {
    let client = must_client(&state).await?;
    let type_ = match kind.as_str() {
        "artists" => TopItemType::Artists,
        "tracks" => TopItemType::Tracks,
        other => return Err(format!("unsupported top item kind: {other}")),
    };
    let time_range = match time_range.as_deref() {
        Some("long_term") => Some(TimeRange::LongTerm),
        Some("medium_term") => Some(TimeRange::MediumTerm),
        Some("short_term") => Some(TimeRange::ShortTerm),
        _ => None,
    };
    let endpoint = GetUserTopItems { type_, time_range };
    let bytes = raw(endpoint)
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to load top items"))?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

#[tauri::command]
async fn playback_state(state: tauri::State<'_, SpotifyState>) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetPlaybackState::default(), "failed to load playback state")
}

#[tauri::command]
async fn devices(state: tauri::State<'_, SpotifyState>) -> Result<Value, String> {
    let client = must_client(&state).await?;
    query_value!(client.as_ref(), GetAvailableDevices, "failed to load devices")
}

#[tauri::command]
async fn play(
    state: tauri::State<'_, SpotifyState>,
    context_uri: Option<String>,
    uris: Option<Vec<String>>,
    position_ms: Option<u32>,
) -> Result<(), String> {
    let client = must_client(&state).await?;
    let selected_device = state.selected_device.lock().await.clone();
    let device_id = match selected_device {
        Some(device_id) => device_id,
        None => {
            let available = query_value!(
                client.as_ref(),
                GetAvailableDevices,
                "failed to find a Spotify playback device"
            )?;
            let devices = available
                .get("devices")
                .and_then(Value::as_array)
                .ok_or_else(|| "Spotify returned an invalid device list".to_string())?;
            devices
                .iter()
                .find(|device| device.get("is_active").and_then(Value::as_bool) == Some(true))
                .or_else(|| devices.first())
                .and_then(|device| device.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| {
                    "No Spotify playback device is available. Wait for local audio to become ready, or open Spotify on another device."
                        .to_string()
                })?
        }
    };

    let mut start = spotify_web_api::api::player::StartPlayback::from(device_id);
    if let Some(uri) = context_uri {
        start = start.context_uri(parse_context_type(&uri)?);
    } else if let Some(uris) = uris {
        let ids = uris
            .into_iter()
            .map(|u| TrackId::from_uri(&u).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        start = start.uris(ids);
    }
    if let Some(ms) = position_ms {
        start = start.position_ms(ms);
    }
    ignore(start)
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to start playback"))
}

#[tauri::command]
async fn pause(state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::PausePlayback::default())
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to pause playback"))
}

#[tauri::command]
async fn resume(state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::StartPlayback::default())
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to resume playback"))
}

#[tauri::command]
async fn skip_next(state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::SkipToNext::default())
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to skip to next"))
}

#[tauri::command]
async fn skip_previous(state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::SkipToPrevious::default())
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to skip to previous"))
}

#[tauri::command]
async fn seek(state: tauri::State<'_, SpotifyState>, position_ms: u32) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::SeekToPosition::from(position_ms))
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to seek"))
}

#[tauri::command]
async fn set_shuffle(
    state: tauri::State<'_, SpotifyState>,
    shuffle: bool,
) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::TogglePlaybackShuffle::from(shuffle))
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to toggle shuffle"))
}

#[tauri::command]
async fn set_repeat(
    state: tauri::State<'_, SpotifyState>,
    mode: String,
) -> Result<(), String> {
    let client = must_client(&state).await?;
    let repeat = match mode.as_str() {
        "off" => RepeatState::Off,
        "context" => RepeatState::Context,
        "track" => RepeatState::Track,
        other => return Err(format!("invalid repeat mode: {other} (expected off|context|track)")),
    };
    ignore(spotify_web_api::api::player::SetRepeatMode::from(repeat))
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to set repeat mode"))
}

#[tauri::command]
async fn set_volume(
    state: tauri::State<'_, SpotifyState>,
    percent: u8,
) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::SetPlaybackVolume::from(percent))
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to set volume"))
}

#[tauri::command]
async fn transfer_playback(
    state: tauri::State<'_, SpotifyState>,
    device_id: String,
) -> Result<(), String> {
    let client = must_client(&state).await?;
    ignore(spotify_web_api::api::player::TransferPlayback::from(device_id.clone()))
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to transfer playback"))?;
    *state.selected_device.lock().await = Some(device_id);
    Ok(())
}

#[tauri::command]
async fn add_to_queue(
    state: tauri::State<'_, SpotifyState>,
    uri: String,
) -> Result<(), String> {
    let client = must_client(&state).await?;
    let track_id = TrackId::from_uri(&uri).map_err(|e| e.to_string())?;
    let item = spotify_web_api::model::player::PlaylistItem::Track(track_id);
    ignore(AddItemToPlaybackQueue::from(item))
        .query_async(client.as_ref())
        .await
        .map_err(api_err!("failed to add to queue"))
}

#[tauri::command]
async fn get_lyrics(
    state: tauri::State<'_, SpotifyState>,
    request: lyrics::LyricsRequest,
) -> Result<Option<lyrics::LyricsDocument>, String> {
    state.lyrics.get(request).await
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SpotifyState {
            client: tokio::sync::Mutex::new(None),
            config: tokio::sync::Mutex::new(config::load()),
            native: tokio::sync::Mutex::new(NativePlaybackState::default()),
            selected_device: tokio::sync::Mutex::new(None),
            lyrics: lyrics::LyricsService::new().expect("failed to initialize lyrics client"),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            session,
            set_client_id,
            app_info,
            native_playback_status,
            start_native_playback,
            search,
            search_category,
            saved_tracks,
            saved_albums,
            playlists,
            playlist,
            playlist_items,
            album,
            artist,
            artist_top_tracks,
            track,
            top_items,
            playback_state,
            devices,
            play,
            pause,
            resume,
            skip_next,
            skip_previous,
            seek,
            set_shuffle,
            set_repeat,
            set_volume,
            transfer_playback,
            add_to_queue,
            get_lyrics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod search_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn focused_artist_merge_promotes_exact_match_and_removes_duplicates() {
        let mut base = json!({
            "artists": { "items": [
                { "id": "radiohead", "name": "Radiohead" },
                { "id": "clara", "name": "Clara Joy" }
            ] }
        });
        let focused = json!({
            "artists": { "items": [
                { "id": "clara", "name": "Clara Joy" },
                { "id": "other", "name": "Clara Joyful" }
            ] }
        });

        merge_focused_artists(&mut base, focused, "clara joy", 10);

        let artists = base["artists"]["items"].as_array().unwrap();
        assert_eq!(artists.len(), 3);
        assert_eq!(artists[0]["id"], "clara");
        assert_eq!(artists.iter().filter(|artist| artist["id"] == "clara").count(), 1);
    }

    #[test]
    fn search_name_matching_ignores_case_spaces_and_punctuation() {
        assert_eq!(normalize_search_name("Clara Joy"), normalize_search_name("clara-joy!"));
        assert_eq!(artist_field_query("Clara \"Joy\""), "artist:\"Clara \\\"Joy\\\"\"");
    }
}
