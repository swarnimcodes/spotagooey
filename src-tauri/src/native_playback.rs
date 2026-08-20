use std::{path::PathBuf, sync::Arc};

use librespot_connect::{ConnectConfig, Spirc};
use librespot_core::{
    authentication::Credentials,
    cache::Cache,
    config::{DeviceType, SessionConfig},
    error::ErrorKind,
    session::Session,
};
use librespot_oauth::OAuthClientBuilder;
use librespot_playback::{
    audio_backend,
    config::{AudioFormat, Bitrate, PlayerConfig},
    mixer::{softmixer::SoftMixer, Mixer, MixerConfig},
    player::Player,
};
use serde::Serialize;

pub const DEVICE_NAME: &str = "Spotagooey";
const STREAMING_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const STREAMING_REDIRECT_URI: &str = "http://127.0.0.1:8989/login";
const STREAMING_SCOPES: [&str; 6] = [
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-library-read",
    "user-read-private",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlaybackInfo {
    pub state: String,
    pub device_name: String,
    pub device_id: Option<String>,
    pub error: Option<String>,
}

pub struct NativePlayer {
    spirc: Spirc,
    session: Session,
    _player: Arc<Player>,
    _task: tokio::task::JoinHandle<()>,
}

enum StartFailure {
    CredentialRejected(String),
    Fatal(String),
}

impl StartFailure {
    fn message(self) -> String {
        match self {
            Self::CredentialRejected(message) | Self::Fatal(message) => message,
        }
    }
}

impl NativePlayer {
    pub async fn start() -> Result<Self, String> {
        let cache_path = cache_path()?;
        ensure_private_dir(&cache_path)?;
        let cache = Cache::new(Some(cache_path.clone()), None, None, None)
            .map_err(|e| format!("failed to open native playback cache: {e:?}"))?;

        let (credentials, used_cached_credentials) = streaming_credentials(&cache).await?;

        match Self::connect_once(&cache_path, cache.clone(), credentials).await {
            Ok(player) => Ok(player),
            Err(StartFailure::CredentialRejected(_)) if used_cached_credentials => {
                clear_cached_credentials(&cache_path)?;
                let credentials = request_streaming_credentials(&cache).await?;
                Self::connect_once(&cache_path, cache, credentials)
                    .await
                    .map_err(StartFailure::message)
            }
            Err(error) => Err(error.message()),
        }
    }

    async fn connect_once(
        cache_path: &std::path::Path,
        cache: Cache,
        credentials: Credentials,
    ) -> Result<Self, StartFailure> {
        // The default librespot session client is the keymaster client that issued
        // the streaming credential above. A regular Web API app token cannot be
        // substituted here even when it includes the `streaming` scope.
        let mut session_config = SessionConfig::default();
        session_config.device_id =
            stable_device_id(cache_path, &session_config.device_id).map_err(StartFailure::Fatal)?;

        let session = Session::new(session_config, Some(cache));
        let mixer =
            Arc::new(SoftMixer::open(MixerConfig::default()).map_err(|e| {
                StartFailure::Fatal(format!("failed to initialize audio volume: {e}"))
            })?);
        mixer.set_volume(52_428); // 80% of librespot's u16 volume range.

        let backend = audio_backend::find(None).ok_or_else(|| {
            let available = audio_backend::BACKENDS
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>()
                .join(", ");
            StartFailure::Fatal(format!(
                "no native audio backend is available (compiled backends: {available})"
            ))
        })?;

        let player = Player::new(
            PlayerConfig {
                bitrate: Bitrate::Bitrate320,
                position_update_interval: Some(std::time::Duration::from_secs(1)),
                ..Default::default()
            },
            session.clone(),
            mixer.get_soft_volume(),
            move || backend(None, AudioFormat::default()),
        );

        let connect_config = ConnectConfig {
            name: DEVICE_NAME.to_string(),
            device_type: DeviceType::Computer,
            initial_volume: 52_428,
            is_group: false,
            disable_volume: false,
            volume_steps: 64,
        };
        let (spirc, spirc_task) = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            Spirc::new(
                connect_config,
                session.clone(),
                credentials,
                player.clone(),
                mixer,
            ),
        )
        .await
        .map_err(|_| {
            StartFailure::Fatal(
                "native playback initialization timed out after 30 seconds".to_string(),
            )
        })?
        .map_err(|error| {
            let message = format!("failed to register Spotagooey as a Spotify device: {error:?}");
            if matches!(
                error.kind,
                ErrorKind::Unauthenticated
                    | ErrorKind::PermissionDenied
                    | ErrorKind::FailedPrecondition
            ) {
                StartFailure::CredentialRejected(message)
            } else {
                StartFailure::Fatal(message)
            }
        })?;

        let task = tokio::spawn(async move {
            let _ = spirc_task.await;
        });

        Ok(Self {
            spirc,
            session,
            _player: player,
            _task: task,
        })
    }

    pub fn info(&self) -> NativePlaybackInfo {
        NativePlaybackInfo {
            state: if self.session.is_invalid() {
                "disconnected".to_string()
            } else {
                "ready".to_string()
            },
            device_name: DEVICE_NAME.to_string(),
            device_id: Some(self.session.device_id().to_string()),
            error: None,
        }
    }

    pub fn shutdown(&self) {
        let _ = self.spirc.shutdown();
        self.session.shutdown();
    }
}

async fn streaming_credentials(cache: &Cache) -> Result<(Credentials, bool), String> {
    if let Some(credentials) = cache.credentials() {
        return Ok((credentials, true));
    }

    Ok((request_streaming_credentials(cache).await?, false))
}

async fn request_streaming_credentials(cache: &Cache) -> Result<Credentials, String> {
    let access_token = tokio::task::spawn_blocking(|| {
        let client = OAuthClientBuilder::new(
            STREAMING_CLIENT_ID,
            STREAMING_REDIRECT_URI,
            STREAMING_SCOPES.to_vec(),
        )
        .open_in_browser()
        .build()
        .map_err(|e| format!("failed to prepare native playback authorization: {e:?}"))?;
        client
            .get_access_token()
            .map(|token| token.access_token)
            .map_err(|e| format!("native playback authorization failed: {e:?}"))
    })
    .await
    .map_err(|e| format!("native playback authorization task failed: {e}"))??;

    let credentials = Credentials::with_access_token(access_token);
    cache.save_credentials(&credentials);
    secure_cache_file(&cache_path()?.join("credentials.json"))?;
    Ok(credentials)
}

fn clear_cached_credentials(cache_path: &std::path::Path) -> Result<(), String> {
    let path = cache_path.join("credentials.json");
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to clear {}: {error}", path.display())),
    }
}

fn secure_cache_file(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("failed to secure {}: {error}", path.display()))?;
    }
    Ok(())
}

impl Drop for NativePlayer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn cache_path() -> Result<PathBuf, String> {
    dirs::cache_dir()
        .map(|path| path.join("spotagooey").join("native-playback"))
        .ok_or_else(|| "could not resolve the native playback cache directory".to_string())
}

fn stable_device_id(cache_path: &std::path::Path, generated: &str) -> Result<String, String> {
    let path = cache_path.join("device_id");
    match std::fs::read_to_string(&path) {
        Ok(value) if !value.trim().is_empty() => return Ok(value.trim().to_string()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to read {}: {error}", path.display())),
    }

    std::fs::write(&path, generated)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
    Ok(generated.to_string())
}

fn ensure_private_dir(path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("failed to create {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("failed to secure {}: {error}", path.display()))?;
    }
    Ok(())
}
