//! Free, key-less Deezer API — used to backfill artist photos (and album covers)
//! that aren't embedded in the local library.

use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

fn client() -> Option<Client> {
    Client::builder().timeout(Duration::from_secs(6)).build().ok()
}

#[derive(Deserialize)]
struct ArtistSearch {
    data: Vec<DeezerArtist>,
}

#[derive(Deserialize)]
struct DeezerArtist {
    picture_xl:     Option<String>,
    picture_big:    Option<String>,
    picture_medium: Option<String>,
}

/// Returns the best available artist photo URL for `name`, or None.
pub async fn artist_image(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let c = client()?;
    let resp = c
        .get("https://api.deezer.com/search/artist")
        .query(&[("q", name), ("limit", "1")])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let search = resp.json::<ArtistSearch>().await.ok()?;
    let a = search.data.into_iter().next()?;
    a.picture_xl
        .or(a.picture_big)
        .or(a.picture_medium)
        .filter(|u| !u.is_empty())
}

#[derive(Deserialize)]
struct AlbumSearch {
    data: Vec<DeezerAlbum>,
}

#[derive(Deserialize)]
struct DeezerAlbum {
    cover_xl:     Option<String>,
    cover_big:    Option<String>,
    cover_medium: Option<String>,
}

/// Returns an album cover URL for "artist title", or None.
pub async fn album_cover(artist: &str, title: &str) -> Option<String> {
    let q = format!("{} {}", artist.trim(), title.trim());
    if q.trim().is_empty() {
        return None;
    }
    let c = client()?;
    let resp = c
        .get("https://api.deezer.com/search/album")
        .query(&[("q", q.as_str()), ("limit", "1")])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let search = resp.json::<AlbumSearch>().await.ok()?;
    let a = search.data.into_iter().next()?;
    a.cover_xl.or(a.cover_big).or(a.cover_medium).filter(|u| !u.is_empty())
}
