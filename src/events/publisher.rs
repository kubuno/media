use anyhow::Result;
use reqwest::Client;
use serde_json::{json, Value};
use uuid::Uuid;

pub struct EventPublisher {
    pub core_url: String,
    pub secret:   String,
    pub http:     Client,
}

impl EventPublisher {
    pub async fn publish(&self, event_type: &str, payload: Value) -> Result<()> {
        let url = format!("{}/internal/events/publish", self.core_url);
        self.http
            .post(&url)
            .header("X-Internal-Secret", &self.secret)
            .json(&json!({
                "event_type":    event_type,
                "source_module": "media",
                "payload":       payload,
            }))
            .send()
            .await?;
        Ok(())
    }

    pub async fn media_played(&self, user_id: Uuid, item_id: Uuid, item_type: &str) -> Result<()> {
        self.publish("MediaPlayed", json!({
            "user_id":   user_id,
            "item_id":   item_id,
            "item_type": item_type,
        })).await
    }

    pub async fn playlist_updated(&self, playlist_id: Uuid, user_id: Uuid) -> Result<()> {
        self.publish("PlaylistUpdated", json!({
            "playlist_id": playlist_id,
            "user_id":     user_id,
        })).await
    }
}
