use config::{Config, ConfigError, Environment, File};
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub server:      ServerSettings,
    pub core:        CoreSettings,
    pub database:    DatabaseSettings,
    pub storage:     StorageSettings,
    pub libraries:   LibrariesSettings,
    pub transcoding: TranscodingSettings,
    pub metadata:    MetadataSettings,
    pub scan:        ScanSettings,
    pub logging:     LoggingSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSettings {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoreSettings {
    pub url:             String,
    pub internal_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseSettings {
    pub host:            String,
    pub port:            u16,
    pub user:            String,
    pub password:        String,
    pub database:        String,
    pub max_connections: u32,
    pub min_connections: u32,
    #[serde(with = "duration_secs")]
    pub connect_timeout: Duration,
    pub run_migrations:  bool,
}

impl DatabaseSettings {
    pub fn connect_options(&self) -> anyhow::Result<sqlx::postgres::PgConnectOptions> {
        Ok(sqlx::postgres::PgConnectOptions::new()
            .host(&self.host)
            .port(self.port)
            .username(&self.user)
            .password(&self.password)
            .database(&self.database))
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageSettings {
    pub backend:           String,
    pub local_path:        String,
    pub temp_path:         String,
    /// Chemin de base du stockage du module files (pour source_type='files_folder').
    /// Doit pointer vers le même répertoire que files.storage.local_path.
    pub files_storage_base: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LibrariesSettings {
    pub default_root: String,
    pub cache_path:   String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TranscodingSettings {
    pub ffmpeg_bin:           String,
    pub ffprobe_bin:          String,
    pub hls_segment_duration: u32,
    pub video_codec:          String,
    pub audio_codec:          String,
    pub max_concurrent:       u32,
    pub keep_transcode_days:  u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetadataSettings {
    pub metadata_language:  String,
    pub musicbrainz_url:    String,
    pub cover_art_url:      String,
    pub musicbrainz_agent:  String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScanSettings {
    pub video_extensions:    Vec<String>,
    pub audio_extensions:    Vec<String>,
    pub subtitle_extensions: Vec<String>,
    pub watch_filesystem:    bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingSettings {
    pub level:  String,
    pub format: LogFormat,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    Pretty,
    Json,
}

impl Settings {
    pub fn load() -> Result<Self, ConfigError> {
        let mut builder = Config::builder()
            .set_default("server.host", "127.0.0.1")?
            .set_default("server.port", 3113i64)?
            .set_default("core.url", "http://127.0.0.1:8080")?
            .set_default("core.internal_secret", "")?
            .set_default("database.host", "localhost")?
            .set_default("database.port", 5432i64)?
            .set_default("database.user", "kubuno")?
            .set_default("database.password", "")?
            .set_default("database.database", "kubuno")?
            .set_default("database.max_connections", 10i64)?
            .set_default("database.min_connections", 1i64)?
            .set_default("database.connect_timeout", 10i64)?
            .set_default("database.run_migrations", true)?
            .set_default("storage.backend", "local")?
            .set_default("storage.local_path", "/var/lib/kubuno/modules/media/files")?
            .set_default("storage.temp_path", "/var/lib/kubuno/modules/media/tmp")?
            .set_default("libraries.default_root", "/var/kubuno/media")?
            .set_default("libraries.cache_path", "/var/kubuno/media/.cache")?
            .set_default("transcoding.ffmpeg_bin", "ffmpeg")?
            .set_default("transcoding.ffprobe_bin", "ffprobe")?
            .set_default("transcoding.hls_segment_duration", 6i64)?
            .set_default("transcoding.video_codec", "libx264")?
            .set_default("transcoding.audio_codec", "aac")?
            .set_default("transcoding.max_concurrent", 2i64)?
            .set_default("transcoding.keep_transcode_days", 30i64)?
            .set_default("metadata.metadata_language", "fr-FR")?
            .set_default("metadata.musicbrainz_url", "https://musicbrainz.org/ws/2")?
            .set_default("metadata.cover_art_url", "https://coverartarchive.org")?
            .set_default("metadata.musicbrainz_agent", "KubunoMedia/0.1.0")?
            .set_default("scan.video_extensions", vec!["mkv","mp4","avi","mov","m4v","ts","wmv","webm","mpg","mpeg"])?
            .set_default("scan.audio_extensions", vec!["mp3","flac","m4a","ogg","opus","wav","aac","wma"])?
            .set_default("scan.subtitle_extensions", vec!["srt","ass","ssa","vtt","sub"])?
            .set_default("scan.watch_filesystem", true)?
            .set_default("logging.level", "info")?
            .set_default("logging.format", "pretty")?
            .add_source(File::with_name("config").required(false))
            .add_source(File::with_name("/etc/kubuno/modules/media/config").required(false))
            .add_source(
                Environment::with_prefix("KM")
                    .separator("__")
                    .try_parsing(true),
            );

        if let Ok(v) = std::env::var("KUBUNO_CORE_URL")        { builder = builder.set_override("core.url",             v)?; }
        if let Ok(v) = std::env::var("KUBUNO_INTERNAL_SECRET") { builder = builder.set_override("core.internal_secret", v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_HOST")         { builder = builder.set_override("database.host",     v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PORT")         { builder = builder.set_override("database.port",     v.parse::<i64>().unwrap_or(5432))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_USER")         { builder = builder.set_override("database.user",     v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PASSWORD")     { builder = builder.set_override("database.password", v)?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_NAME")         { builder = builder.set_override("database.database", v)?; }

        builder.build()?.try_deserialize()
    }
}

mod duration_secs {
    use serde::{Deserialize, Deserializer};
    use std::time::Duration;
    pub fn deserialize<'de, D>(d: D) -> Result<Duration, D::Error>
    where D: Deserializer<'de> {
        let secs = u64::deserialize(d)?;
        Ok(Duration::from_secs(secs))
    }
}
