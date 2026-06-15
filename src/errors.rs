use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("Non authentifié")]
    Unauthorized,

    #[error("Accès refusé")]
    Forbidden,

    #[error("Ressource introuvable: {0}")]
    NotFound(String),

    #[error("Données invalides: {0}")]
    Validation(String),

    #[error("Conflit: {0}")]
    Conflict(String),

    #[error("Erreur base de données")]
    Database(#[from] sqlx::Error),

    #[error("Erreur de stockage: {0}")]
    Storage(String),

    #[error("FFmpeg/FFprobe indisponible: {0}")]
    Ffmpeg(String),

    #[error("Erreur interne")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for MediaError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            MediaError::Unauthorized  => (StatusCode::UNAUTHORIZED,           "UNAUTHORIZED",    self.to_string()),
            MediaError::Forbidden     => (StatusCode::FORBIDDEN,              "FORBIDDEN",       self.to_string()),
            MediaError::NotFound(m)   => (StatusCode::NOT_FOUND,              "NOT_FOUND",       m.clone()),
            MediaError::Validation(m) => (StatusCode::UNPROCESSABLE_ENTITY,   "VALIDATION",      m.clone()),
            MediaError::Conflict(m)   => (StatusCode::CONFLICT,               "CONFLICT",        m.clone()),
            MediaError::Ffmpeg(m)     => (StatusCode::SERVICE_UNAVAILABLE,    "FFMPEG_ERROR",    m.clone()),
            MediaError::Storage(m)    => (StatusCode::INTERNAL_SERVER_ERROR,  "STORAGE_ERROR",   m.clone()),
            MediaError::Database(e)   => {
                tracing::error!(error = %e, "Erreur base de données");
                (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Erreur base de données".into())
            }
            MediaError::Internal(e)   => {
                tracing::error!(error = %e, "Erreur interne");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Erreur interne".into())
            }
        };
        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}
