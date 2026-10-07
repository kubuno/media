use std::path::Path;
use walkdir::WalkDir;

/// Liste tous les fichiers d'un dossier correspondant aux extensions données.
pub fn find_files<'a>(
    root:       &Path,
    extensions: &'a [String],
) -> impl Iterator<Item = walkdir::DirEntry> + 'a {
    WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(move |e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| extensions.iter().any(|allowed| allowed.eq_ignore_ascii_case(ext)))
                .unwrap_or(false)
        })
}

/// Extrait un titre et une année depuis le nom d'un fichier vidéo.
/// Ex: "Dune.2021.mkv" → ("Dune", Some(2021))
/// Ex: "The.Dark.Knight.2008.1080p.mkv" → ("The Dark Knight", Some(2008))
pub fn parse_video_filename(filename: &str) -> (String, Option<i32>) {
    // Retirer l'extension
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);

    // Chercher une année (4 chiffres entre 1900 et 2099)
    let year_re = regex::Regex::new(r"\b(19|20)\d{2}\b").expect("regex valide");
    let year = year_re.find(stem)
        .and_then(|m| m.as_str().parse::<i32>().ok());

    // Tout ce qui précède l'année = titre (on remplace . et _ par espace)
    let title = if let Some(m) = year_re.find(stem) {
        &stem[..m.start()]
    } else {
        stem
    };

    let title = title
        .replace(['.', '_', '(', '[', '{'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(|c: char| !c.is_alphanumeric())
        .trim()
        .to_string();

    let title = if title.is_empty() { stem.replace(['.', '_'], " ").trim().to_string() } else { title };

    (title, year)
}

/// Parse season/episode numbers and show name from an episode filename.
/// Handles patterns: S01E02, s1e2, 1x02
/// Returns (season, episode, show_name_from_filename).
pub fn parse_episode_filename(filename: &str) -> (i32, i32, String) {
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);

    // Pattern: S01E02 / s1e2
    let se_re = regex::Regex::new(r"(?i)[Ss](\d{1,2})[Ee](\d{1,2})").unwrap();
    if let Some(caps) = se_re.find(stem).map(|m| (m, se_re.captures(stem).unwrap())) {
        let season:  i32 = caps.1[1].parse().unwrap_or(1);
        let episode: i32 = caps.1[2].parse().unwrap_or(1);
        let prefix = &stem[..caps.0.start()];
        let show_name = prefix
            .replace(['.', '_', '-'], " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        return (season, episode, show_name);
    }

    // Pattern: 1x02
    let nx_re = regex::Regex::new(r"(\d{1,2})x(\d{1,2})").unwrap();
    if let Some(caps) = nx_re.captures(stem) {
        let season:  i32 = caps[1].parse().unwrap_or(1);
        let episode: i32 = caps[2].parse().unwrap_or(1);
        let prefix = &stem[..caps.get(0).unwrap().start()];
        let show_name = prefix
            .replace(['.', '_', '-'], " ")
            .trim()
            .to_string();
        return (season, episode, show_name);
    }

    (1, 1, stem.replace(['.', '_'], " ").trim().to_string())
}

/// Derive the show name from a file path using directory structure.
/// Convention: /lib/<ShowName>/Season 01/S01E02.mkv  OR  /lib/<ShowName>/S01E02.mkv
pub fn parse_show_name_from_path(path: &std::path::Path) -> Option<String> {
    let components: Vec<_> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();
    let n = components.len();
    if n < 2 {
        return None;
    }
    let parent = components[n - 2];
    // If parent looks like "Season 01", "Season1", "S01" go up one more
    let season_re = regex::Regex::new(r"(?i)^(season|s(?:eason)?)\s*\d+$").unwrap();
    if season_re.is_match(parent) && n >= 3 {
        return Some(components[n - 3].to_string());
    }
    Some(parent.to_string())
}

/// Extrait artiste/album/titre depuis les composants du chemin d'un fichier audio.
/// Convention courante : /Bibliothèque/Artiste/Album/01 - Titre.mp3
pub fn parse_audio_path(path: &Path) -> (Option<String>, Option<String>, String) {
    let components: Vec<_> = path.components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    let n = components.len();
    let title = path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| {
            // Retirer préfixe numérique "01 - " ou "01. "
            let re = regex::Regex::new(r"^\d+[\s._-]+").expect("regex valide");
            re.replace(s, "").trim().to_string()
        })
        .unwrap_or_default();

    let album  = if n >= 2 { Some(components[n - 2].to_string()) } else { None };
    let artist = if n >= 3 { Some(components[n - 3].to_string()) } else { None };

    (artist, album, title)
}
