use serde::Serialize;
use spotify_web_api::{
    auth::scopes,
    model::{token::Token, CurrentUserProfile},
    AsyncSpotifyPKCE,
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

pub struct CallbackServer {
    receiver: tokio::sync::oneshot::Receiver<String>,
    cancel: std::sync::mpsc::Sender<()>,
}

impl CallbackServer {
    pub async fn wait(mut self, timeout: std::time::Duration) -> Result<String, String> {
        tokio::time::timeout(timeout, &mut self.receiver)
            .await
            .map_err(|_| "timed out waiting for Spotify authorization (5 min)".to_string())?
            .map_err(|_| "callback server stopped before authorization completed".to_string())
    }
}

impl Drop for CallbackServer {
    fn drop(&mut self) {
        let _ = self.cancel.send(());
    }
}

pub fn spawn_callback_server(port: u16) -> Result<CallbackServer, String> {
    let addr = format!("127.0.0.1:{port}");
    let server = tiny_http::Server::http(addr).map_err(|e| {
        format!("failed to start callback server on port {port} (is it in use?): {e}")
    })?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let (cancel_tx, cancel_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || loop {
        match cancel_rx.try_recv() {
            Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            Err(std::sync::mpsc::TryRecvError::Empty) => {}
        }

        match server.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(Some(request)) => {
                let url = request.url().to_string();
                let response = tiny_http::Response::from_string(
                        "<!doctype html>
                         <html lang=\"en\">
                         <meta charset=\"utf-8\">
                         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
                         <title>Signed in to Spotagooey</title>
                         <body style=\"margin:0;background:#1d1d27;color:#f3f0dc;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center;text-align:center\">
                           <main style=\"padding:32px\">
                             <div style=\"font-size:48px\">&#10003;</div>
                             <h1>You're signed in</h1>
                             <p style=\"color:#aaa8a0\">Return to Spotagooey. You can close this tab.</p>
                           </main>
                         </body>
                         </html>",
                    );
                let _ = request.respond(response);
                let _ = tx.send(url);
                break;
            }
            Ok(None) => {}
            Err(_) => break,
        }
    });
    Ok(CallbackServer {
        receiver: rx,
        cancel: cancel_tx,
    })
}

pub async fn complete_login(client: &AsyncSpotifyPKCE, callback_url: &str) -> Result<(), String> {
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
        let image_url = user.images.first().map(|img| img.url.clone());
        Self {
            display_name: user.display_name.clone(),
            id: user.id.clone(),
            email: user.email.clone(),
            image_url,
            product: user.product.as_ref().map(|p| p.to_string()),
        }
    }
}
