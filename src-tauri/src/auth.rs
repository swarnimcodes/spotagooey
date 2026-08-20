use serde::Serialize;
use spotify_web_api::{
    model::{token::Token, CurrentUserProfile},
    AsyncSpotifyPKCE, auth::scopes,
};

pub fn build_client(client_id: &str, redirect_uri: &str) -> Result<AsyncSpotifyPKCE, String> {
    let mut scopes_set = scopes::all();
    scopes_set.insert(scopes::Scope::UserReadPlaybackState);
    scopes_set.insert(scopes::Scope::UserModifyPlaybackState);
    scopes_set.insert(scopes::Scope::UserReadCurrentlyPlaying);
    scopes_set.insert(scopes::Scope::UserLibraryRead);
    scopes_set.insert(scopes::Scope::UserLibraryModify);
    scopes_set.insert(scopes::Scope::PlaylistReadPrivate);
    scopes_set.insert(scopes::Scope::PlaylistReadCollaborative);
    scopes_set.insert(scopes::Scope::PlaylistModifyPublic);
    scopes_set.insert(scopes::Scope::PlaylistModifyPrivate);
    scopes_set.insert(scopes::Scope::UserFollowRead);
    scopes_set.insert(scopes::Scope::UserFollowModify);
    scopes_set.insert(scopes::Scope::UserReadEmail);
    scopes_set.insert(scopes::Scope::UserReadPrivate);

    AsyncSpotifyPKCE::with_authorization_code_pkce(client_id, redirect_uri, Some(scopes_set))
        .map_err(|e| format!("failed to create Spotify client: {e}"))
}

pub fn spawn_callback_server(port: u16) -> Result<tokio::sync::oneshot::Receiver<String>, String> {
    let addr = format!("127.0.0.1:{port}");
    let server = tiny_http::Server::http(addr)
        .map_err(|e| format!("failed to start callback server on port {port} (is it in use?): {e}"))?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        if let Ok(request) = server.recv() {
            let url = request.url().to_string();
            let response = tiny_http::Response::from_string(
                "<html><body style=\"font-family: system-ui; text-align: center; padding-top: 120px;\">
                 <h2>Authorization complete</h2>
                 <p>You can close this tab and return to spotagooey.</p>
                 </body></html>",
            );
            let _ = request.respond(response);
            let _ = tx.send(url);
        }
    });
    Ok(rx)
}

pub async fn complete_login(
    client: &AsyncSpotifyPKCE,
    callback_url: &str,
) -> Result<(), String> {
    client
        .request_token_from_redirect_url(callback_url)
        .await
        .map_err(|e| format!("token exchange failed: {e}"))
}

pub fn token(client: &AsyncSpotifyPKCE) -> Option<Token> {
    client.token().read().clone()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub display_name: Option<String>,
    pub id: String,
    pub email: Option<String>,
    pub image_url: Option<String>,
    pub product: Option<String>,
}

impl From<&CurrentUserProfile> for LoginResult {
    fn from(user: &CurrentUserProfile) -> Self {
        let image_url = user
            .images
            .first()
            .map(|img| img.url.clone());
        Self {
            display_name: user.display_name.clone(),
            id: user.id.clone(),
            email: user.email.clone(),
            image_url,
            product: user.product.as_ref().map(|p| p.to_string()),
        }
    }
}
