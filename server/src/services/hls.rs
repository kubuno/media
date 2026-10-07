use std::path::PathBuf;

pub fn segment_path(cache_path: &str, item_id: &str, quality: &str, seg: u32) -> PathBuf {
    PathBuf::from(cache_path)
        .join("hls")
        .join(item_id)
        .join(quality)
        .join(format!("seg{:05}.ts", seg))
}

pub fn playlist_path(cache_path: &str, item_id: &str, quality: &str) -> PathBuf {
    PathBuf::from(cache_path)
        .join("hls")
        .join(item_id)
        .join(quality)
        .join("playlist.m3u8")
}

pub fn output_dir(cache_path: &str, item_id: &str, quality: &str) -> PathBuf {
    PathBuf::from(cache_path)
        .join("hls")
        .join(item_id)
        .join(quality)
}
