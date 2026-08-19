//! Instance-wide settings of the media module, as the administrator left them in
//! the console.
//!
//! Declared by `module.toml`'s `[[settings]]`, stored in `core.settings`, and read
//! back here through `/internal/modules/media/settings` — a module owns its own
//! schema and cannot read the core's tables, and a background worker has no user
//! token for the public config route. The module is named in the URL so the read
//! works whether the instance shares one master secret or a derived one per
//! module.
//!
//! The metadata provider API KEYS are NOT here: they are secrets kept in the
//! module's own `media.settings` table and served by the guarded
//! `/media/admin/settings` routes. Only non-secret scalars travel through the
//! core.
//!
//! Every field here is read by code that acts on it: a knob that changes nothing
//! is worse than an absent one.

use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub struct InstanceConfig {
    /// Highest age rating a non-admin may play, in years. `0` disables the
    /// restriction entirely. Enforced on the streaming routes and used to hide
    /// the matching movies from lists, details and search.
    pub max_content_age: u8,
    /// Whether a movie carrying NO recognised certification is blocked too.
    /// Only meaningful while `max_content_age > 0`.
    pub block_unrated_content: bool,
    /// Minutes between two full library re-scans by the watcher. `0` = never
    /// (manual scans only); the inotify watcher keeps indexing new files.
    pub library_rescan_minutes: i64,
}

impl Default for InstanceConfig {
    fn default() -> Self {
        Self {
            max_content_age:        0,
            block_unrated_content:  false,
            library_rescan_minutes: 5,
        }
    }
}

impl InstanceConfig {
    /// Maps the core's `{key: value}` object onto the struct. Every read falls
    /// back to the compiled default rather than to a permissive value; an
    /// out-of-range number is treated as a mistake and ignored the same way.
    /// `0` is a MEANINGFUL value for both integer settings (no age restriction /
    /// no periodic re-scan), so it is accepted rather than floored away.
    pub fn from_settings(settings: &Value) -> Self {
        let d = Self::default();
        let int_in = |key: &str, min: i64, max: i64, fallback: i64| -> i64 {
            settings
                .get(key)
                .and_then(Value::as_i64)
                .filter(|n| (min..=max).contains(n))
                .unwrap_or(fallback)
        };
        let bool_of = |key: &str, fallback: bool| {
            settings.get(key).and_then(Value::as_bool).unwrap_or(fallback)
        };

        Self {
            max_content_age:        int_in("max_content_age", 0, 21, d.max_content_age as i64) as u8,
            block_unrated_content:  bool_of("block_unrated_content", d.block_unrated_content),
            library_rescan_minutes: int_in("library_rescan_minutes", 0, 10_080, d.library_rescan_minutes),
        }
    }

    /// Whether the parental restriction is armed at all. When it is not, no
    /// rating lookup is worth a round-trip to the database.
    pub fn parental_active(&self) -> bool {
        self.max_content_age > 0
    }

    /// The periodic re-scan interval as a duration, or `None` when the
    /// administrator asked for manual scans only.
    pub fn rescan_interval(&self) -> Option<std::time::Duration> {
        (self.library_rescan_minutes > 0)
            .then(|| std::time::Duration::from_secs(self.library_rescan_minutes as u64 * 60))
    }
}

/// Reads the instance settings from the core. Any failure yields `None`, so the
/// caller keeps the values it already had rather than reverting to defaults
/// because the core was briefly unreachable.
pub async fn fetch(http: &reqwest::Client, core_url: &str, secret: &str) -> Option<InstanceConfig> {
    let url = format!("{core_url}/internal/modules/media/settings");
    let resp = http
        .get(&url)
        .header("X-Internal-Secret", secret)
        .send()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Lecture des réglages d'instance media"))
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!(status = %resp.status(), "Réglages d'instance media refusés par le core");
        return None;
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Réglages d'instance media : réponse illisible"))
        .ok()?;

    Some(InstanceConfig::from_settings(body.get("settings")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_keep_the_compiled_defaults() {
        let c = InstanceConfig::from_settings(&json!({}));
        assert_eq!(c.max_content_age, 0);
        assert!(!c.block_unrated_content);
        assert_eq!(c.library_rescan_minutes, 5);
    }

    /// The shipped default is an OPEN instance: an administrator who never
    /// visited the console must not discover their library half hidden.
    #[test]
    fn parental_control_is_off_until_asked_for() {
        let c = InstanceConfig::from_settings(&json!({}));
        assert!(!c.parental_active());
    }

    #[test]
    fn zero_is_meaningful_for_both_integers() {
        let c = InstanceConfig::from_settings(&json!({
            "max_content_age": 0, "library_rescan_minutes": 0,
        }));
        assert_eq!(c.max_content_age, 0);
        assert_eq!(c.library_rescan_minutes, 0);
        assert!(c.rescan_interval().is_none());
    }

    #[test]
    fn out_of_range_values_fall_back_to_the_defaults() {
        let c = InstanceConfig::from_settings(&json!({
            "max_content_age": 99, "library_rescan_minutes": -30,
        }));
        assert_eq!(c.max_content_age, 0);
        assert_eq!(c.library_rescan_minutes, 5);
    }

    #[test]
    fn a_set_age_arms_the_restriction_and_the_interval_is_in_minutes() {
        let c = InstanceConfig::from_settings(&json!({
            "max_content_age": 12, "block_unrated_content": true, "library_rescan_minutes": 60,
        }));
        assert!(c.parental_active());
        assert_eq!(c.max_content_age, 12);
        assert!(c.block_unrated_content);
        assert_eq!(c.rescan_interval(), Some(std::time::Duration::from_secs(3600)));
    }

    /// A value of the wrong JSON type must not silently loosen or tighten a
    /// protection: the compiled default stands.
    #[test]
    fn wrong_types_are_ignored() {
        let c = InstanceConfig::from_settings(&json!({
            "max_content_age": "12", "block_unrated_content": "yes",
        }));
        assert_eq!(c.max_content_age, 0);
        assert!(!c.block_unrated_content);
    }
}
