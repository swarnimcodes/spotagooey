use serde::{Deserialize, Serialize};
use spotify_web_api::model::token::Token;

pub const DEFAULT_REDIRECT_PORT: u16 = 8431;
pub const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8431/callback";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub client_id: Option<String>,
    pub redirect_uri: String,
    pub port: u16,
    pub token: Option<Token>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            client_id: None,
            redirect_uri: DEFAULT_REDIRECT_URI.to_string(),
            port: DEFAULT_REDIRECT_PORT,
            token: None,
        }
    }
}

pub fn config_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|dir| dir.join("spotagooey").join("client.yml"))
}

pub fn load() -> Config {
    match config_path().and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(content) => serde_yaml::from_str(&content).unwrap_or_default(),
        None => Config::default(),
    }
}

pub fn save(config: &Config) -> Result<(), String> {
    let path = config_path().ok_or_else(|| "could not resolve config directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config directory: {e}"))?;
    }
    let content =
        serde_yaml::to_string(config).map_err(|e| format!("failed to serialize config: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn resolved_client_id() -> Option<String> {
    std::env::var("SPOTIFY_CLIENT_ID")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| load().client_id.filter(|s| !s.is_empty()))
}