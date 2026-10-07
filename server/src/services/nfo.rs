//! Support for standard `.nfo` local metadata files (read-only).
//! Local metadata has priority over remote providers.
//! Parsing is regex-based (NFO files are flat XML), avoiding an XML dependency.

use std::path::Path;

#[derive(Debug, Default, Clone)]
pub struct MovieNfo {
    pub title:          Option<String>,
    pub original_title: Option<String>,
    pub plot:           Option<String>,
    pub year:           Option<i32>,
    pub genres:         Vec<String>,
    pub mpaa:           Option<String>,
    pub tmdb_id:        Option<i32>,
    pub imdb_id:        Option<String>,
    /// `<lockdata>true</lockdata>` — the item's metadata is
    /// authoritative and must not be refreshed from the internet.
    pub lockdata:       bool,
}

#[derive(Debug, Default, Clone)]
pub struct ShowNfo {
    pub title:    Option<String>,
    pub plot:     Option<String>,
    pub genres:   Vec<String>,
    pub tmdb_id:  Option<i32>,
    pub lockdata: bool,
}

/// Decode the basic XML entities NFO writers emit.
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .trim()
        .to_string()
}

fn tag(content: &str, name: &str) -> Option<String> {
    let re = regex::Regex::new(&format!(r"(?is)<{name}>\s*(.*?)\s*</{name}>")).ok()?;
    re.captures(content)
        .map(|c| decode_entities(&c[1]))
        .filter(|s| !s.is_empty())
}

fn tags(content: &str, name: &str) -> Vec<String> {
    let Ok(re) = regex::Regex::new(&format!(r"(?is)<{name}>\s*(.*?)\s*</{name}>")) else {
        return vec![];
    };
    re.captures_iter(content)
        .map(|c| decode_entities(&c[1]))
        .filter(|s| !s.is_empty())
        .collect()
}

/// `<uniqueid type="tmdb">603</uniqueid>` — the standard provider ID element.
fn uniqueid(content: &str, provider: &str) -> Option<String> {
    let re = regex::Regex::new(&format!(
        r#"(?is)<uniqueid[^>]*type\s*=\s*"{provider}"[^>]*>\s*(.*?)\s*</uniqueid>"#
    ))
    .ok()?;
    re.captures(content)
        .map(|c| decode_entities(&c[1]))
        .filter(|s| !s.is_empty())
}

fn parse_movie(content: &str) -> MovieNfo {
    MovieNfo {
        title:          tag(content, "title"),
        original_title: tag(content, "originaltitle"),
        plot:           tag(content, "plot"),
        year:           tag(content, "year").and_then(|y| y.parse().ok()),
        genres:         tags(content, "genre"),
        mpaa:           tag(content, "mpaa"),
        tmdb_id:        uniqueid(content, "tmdb")
            .or_else(|| tag(content, "tmdbid"))
            .and_then(|s| s.parse().ok()),
        imdb_id:        uniqueid(content, "imdb")
            .or_else(|| tag(content, "imdbid"))
            .or_else(|| tag(content, "id").filter(|s| s.starts_with("tt"))),
        lockdata:       tag(content, "lockdata").map(|v| v.eq_ignore_ascii_case("true")).unwrap_or(false),
    }
}

fn parse_show(content: &str) -> ShowNfo {
    ShowNfo {
        title:    tag(content, "title"),
        plot:     tag(content, "plot"),
        genres:   tags(content, "genre"),
        tmdb_id:  uniqueid(content, "tmdb")
            .or_else(|| tag(content, "tmdbid"))
            .and_then(|s| s.parse().ok()),
        lockdata: tag(content, "lockdata").map(|v| v.eq_ignore_ascii_case("true")).unwrap_or(false),
    }
}

/// Read the NFO next to a movie file: `<stem>.nfo`, else `movie.nfo` in the
/// same directory (standard NFO conventions).
pub async fn read_movie_nfo(video_path: &Path) -> Option<MovieNfo> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let (Some(dir), Some(stem)) = (video_path.parent(), video_path.file_stem()) {
        candidates.push(dir.join(format!("{}.nfo", stem.to_string_lossy())));
        candidates.push(dir.join("movie.nfo"));
    }
    for p in candidates {
        if let Ok(content) = tokio::fs::read_to_string(&p).await {
            tracing::info!(nfo = %p.display(), "NFO film trouvé");
            return Some(parse_movie(&content));
        }
    }
    None
}

/// Read `tvshow.nfo` from the show directory (the episode's parent, or its
/// grandparent when episodes live in "Season NN" folders).
pub async fn read_show_nfo(episode_path: &Path) -> Option<ShowNfo> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(dir) = episode_path.parent() {
        candidates.push(dir.join("tvshow.nfo"));
        if let Some(parent) = dir.parent() {
            candidates.push(parent.join("tvshow.nfo"));
        }
    }
    for p in candidates {
        if let Ok(content) = tokio::fs::read_to_string(&p).await {
            tracing::info!(nfo = %p.display(), "NFO série trouvé");
            return Some(parse_show(&content));
        }
    }
    None
}
