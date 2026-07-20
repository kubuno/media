use axum::{
    routing::{delete, get, patch, post, put},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    handlers::{
        admin, albums, artists, identify, libraries, movies, playlists, progress, radio, search, shows, stream, tracks, tv,
    },
    middleware::require_auth,
    state::AppState,
};

pub fn build(state: AppState) -> Router {
    let authed = Router::new()
        // Health
        .route("/health", get(health))
        // Libraries
        .route("/libraries",              get(libraries::list_libraries).post(libraries::create_library))
        .route("/libraries/scan-all",     post(libraries::scan_all_libraries))
        .route("/libraries/files-folders", get(libraries::list_files_folders))
        .route("/libraries/:id",          patch(libraries::update_library).delete(libraries::delete_library))
        .route("/libraries/:id/shares",   put(libraries::set_library_shares))
        .route("/libraries/:id/scan",     post(libraries::start_scan))
        .route("/libraries/:id/scan/status", get(libraries::scan_status))
        // Movies
        .route("/movies",                 get(movies::list_movies))
        .route("/movies/recent",          get(movies::recent_movies))
        .route("/movies/continue",        get(movies::continue_watching))
        .route("/movies/trailer-search",  get(movies::trailer_search))
        .route("/movies/:id",             get(movies::get_movie))
        .route("/movies/:id/mark-watched",   post(movies::mark_watched))
        .route("/movies/:id/refresh-meta",   post(movies::refresh_metadata))
        .route("/movies/:id/dissociate",     post(movies::dissociate))
        .route("/movies/:id/watchlist-status", get(movies::watchlist_status))
        .route("/movies/:id/play-history",   get(movies::play_history))
        .route("/movies/:id/set-poster",     post(movies::set_poster))
        .route("/movies/:id/identify",       get(identify::identify_movie_search).post(identify::identify_movie_apply))
        .route("/movies/:id/lock-meta",      post(identify::lock_movie))
        // Watchlist
        .route("/watchlist",                 get(movies::get_watchlist).post(movies::watchlist_add))
        .route("/watchlist/:item_type/:item_id", delete(movies::watchlist_remove))
        // TV Shows
        .route("/shows",                  get(shows::list_shows))
        .route("/shows/:id",              get(shows::get_show))
        .route("/shows/:id/seasons/:n/episodes", get(shows::get_season_episodes))
        .route("/shows/:id/identify",     get(identify::identify_show_search).post(identify::identify_show_apply))
        .route("/shows/:id/refresh-meta", post(identify::refresh_show))
        .route("/shows/:id/lock-meta",    post(identify::lock_show))
        // Streaming
        .route("/stream/:id/master.m3u8", get(stream::master_playlist))
        .route("/stream/:id/:quality/playlist.m3u8", get(stream::quality_playlist))
        .route("/stream/:id/:quality/:seg.ts", get(stream::hls_segment))
        .route("/stream/:id/direct",      get(stream::direct_stream))
        .route("/audio/:id/stream",       get(stream::audio_stream))
        // Artists
        .route("/artists",                get(artists::list_artists))
        .route("/artists/:id",            get(artists::get_artist))
        .route("/artists/:id/identify",   get(identify::identify_artist_search).post(identify::identify_artist_apply))
        .route("/artists/:id/refresh-meta", post(identify::refresh_artist))
        .route("/artists/:id/lock-meta",  post(identify::lock_artist))
        // Albums
        .route("/albums",                 get(albums::list_albums))
        .route("/albums/recent",          get(albums::recent_albums))
        .route("/albums/:id",             get(albums::get_album))
        .route("/albums/:id/identify",    get(identify::identify_album_search).post(identify::identify_album_apply))
        .route("/albums/:id/refresh-meta", post(identify::refresh_album))
        .route("/albums/:id/lock-meta",   post(identify::lock_album))
        .route("/albums/:id/cover",       get(albums::get_album_cover))
        // Tracks
        .route("/tracks/:id",             get(tracks::get_track))
        .route("/tracks/:id/lyrics",      get(tracks::get_lyrics))
        .route("/tracks/:id/like",        post(tracks::toggle_like).get(tracks::like_status))
        .route("/tracks/liked",           get(tracks::liked_tracks))
        .route("/tracks/recently-played", get(tracks::recently_played))
        // Playlists
        .route("/playlists",              get(playlists::list_playlists).post(playlists::create_playlist))
        .route("/playlists/:id",          get(playlists::get_playlist).patch(playlists::update_playlist).delete(playlists::delete_playlist))
        .route("/playlists/:id/tracks",   post(playlists::add_tracks))
        .route("/playlists/:id/tracks/:track_id", delete(playlists::remove_track))
        // Progress
        .route("/progress/:item_type/:item_id", get(progress::get_video_progress).post(progress::save_video_progress))
        .route("/listen",                 post(progress::record_listen))
        .route("/listen/history",         get(progress::get_listen_history))
        // Web radio
        .route("/radio/stations",         get(radio::list_stations).post(radio::create_station))
        .route("/radio/stations/:id",     patch(radio::update_station).delete(radio::delete_station))
        .route("/radio/stations/:id/favorite", post(radio::toggle_favorite))
        .route("/radio/stations/:id/play",     post(radio::record_play))
        .route("/radio/tags",             get(radio::list_tags))
        .route("/radio/favorites",        get(radio::list_favorites))
        .route("/radio/recent",           get(radio::list_recent))
        .route("/radio/discover",         get(radio::discover))
        .route("/radio/stations/:id/stream", get(radio::stream))
        // Web TV
        .route("/tv/channels",            get(tv::list_channels).post(tv::create_channel))
        .route("/tv/channels/:id",        delete(tv::delete_channel))
        .route("/tv/channels/:id/favorite", post(tv::toggle_favorite))
        .route("/tv/channels/:id/play",   post(tv::record_play))
        .route("/tv/channels/:id/stream", get(tv::stream))
        .route("/tv/categories",          get(tv::list_categories))
        .route("/tv/favorites",           get(tv::list_favorites))
        .route("/tv/recent",              get(tv::list_recent))
        .route("/tv/discover",            get(tv::discover))
        .route("/tv/proxy",               get(tv::proxy))
        // Search
        .route("/search",                 get(search::search))
        // Admin
        .route("/admin/settings",         get(admin::get_settings).patch(admin::patch_settings))
        .route("/admin/enrich",           post(admin::trigger_enrich))
        .layer(axum::middleware::from_fn_with_state(state.clone(), require_auth));

    Router::new()
        .nest("/", authed)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "module": "media",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
