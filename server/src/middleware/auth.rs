use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
pub struct AuthUser {
    pub id:    Uuid,
    pub email: String,
    pub role:  String,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let headers = req.headers();
    let user = verify_token(headers, &state);

    match user {
        Some(u) => {
            req.extensions_mut().insert(u);
            Ok(next.run(req).await)
        }
        None => {
            let core_url = &state.settings.core.url;
            let token = extract_bearer(headers).ok_or(StatusCode::UNAUTHORIZED)?;
            let url = format!("{}/api/v1/me", core_url);
            let resp = state.http
                .get(&url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| StatusCode::UNAUTHORIZED)?;

            if !resp.status().is_success() {
                return Err(StatusCode::UNAUTHORIZED);
            }

            let user: AuthUser = resp.json().await.map_err(|_| StatusCode::UNAUTHORIZED)?;
            req.extensions_mut().insert(user);
            Ok(next.run(req).await)
        }
    }
}

/// This module's id, used as the token audience.
const MODULE_ID: &str = "media";

/// Resolve the caller from the signed `X-Kubuno-Auth` token the core mints with
/// this module's internal secret (see `kubuno-modauth`), instead of trusting the
/// plain `X-Kubuno-User-*` headers, which any process reaching this module's
/// loopback port could forge to impersonate any user. When no token is present
/// (`None`), the caller falls back to validating a bearer token against the core
/// (`/api/v1/me`), which stays safe.
fn verify_token(headers: &HeaderMap, state: &AppState) -> Option<AuthUser> {
    let token = headers.get(kubuno_modauth::TOKEN_HEADER)?.to_str().ok()?;
    let user = kubuno_modauth::verify(
        state.settings.core.internal_secret.as_bytes(),
        token,
        MODULE_ID,
    )
    .ok()?;
    Some(AuthUser {
        id:    user.id,
        email: user.email,
        role:  user.role,
    })
}

fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    let auth = headers.get("Authorization")?.to_str().ok()?;
    auth.strip_prefix("Bearer ")
}
