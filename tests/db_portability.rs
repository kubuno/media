//! Runs the media module's own migrations and the query shapes its services
//! issue against a real server of **each** engine, from a single compiled
//! binary — the proof that the engine is a run-time choice, not a build-time
//! one, and that the pieces the port changed (JSON array columns, the
//! floating-point rating columns, the portable upsert and count) behave
//! identically on all of them.
//!
//! * SQLite always runs (a temp file, no server).
//! * PostgreSQL runs when `KUBUNO_PG_TEST_URL` points at a throwaway database.
//! * MySQL/MariaDB runs when `KUBUNO_MYSQL_TEST_URL` does.
//!
//! ```sh
//! KUBUNO_PG_TEST_URL=postgres://u:p@127.0.0.1:5432/kubuno_test \
//! KUBUNO_MYSQL_TEST_URL=mysql://u:p@127.0.0.1:3306/media \
//!   cargo test --test db_portability
//! ```

use kubuno_db::dialect::Assign;
use kubuno_db::{new_id, params};
use kubuno_media::models::{library::MediaLibraryFull, video::Movie};
use kubuno_media::SCHEMA;

fn base_settings(engine: &str) -> kubuno_db::DbSettings {
    kubuno_db::DbSettings {
        engine: engine.to_string(),
        url: None,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        path: None,
        max_connections: 4,
        min_connections: 0,
        connect_timeout: std::time::Duration::from_secs(10),
        run_migrations: true,
        schema_prefix: None,
    }
}

/// Migrations run one at a time: the PostgreSQL and MySQL suites may share a server.
static EXCLUSIVE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn migrated_pool(settings: kubuno_db::DbSettings) -> (kubuno_db::DbPool, impl Sized) {
    let guard = EXCLUSIVE.lock().await;
    let pool = kubuno_db::connect(&settings, SCHEMA).await.expect("connect");
    kubuno_db::migrations!(
        "./migrations/postgres",
        "./migrations/mysql",
        "./migrations/sqlite",
    )
    .run(&pool, SCHEMA)
    .await
    .expect("migrations");
    (pool, guard)
}

/// One library + one movie + one video_progress row, scoped to fresh random
/// ids so re-runs against a persistent server do not collide.
async fn full_suite(pool: &kubuno_db::DbPool) {
    // ── 1. A library with a JSON UUID-array column (shared_user_ids) ──────────
    let lib_id = new_id();
    let shared = vec![new_id(), new_id()];
    pool.execute(
        "INSERT INTO media.libraries (id, name, lib_type, path, shared_user_ids) \
         VALUES ($1, $2, $3, $4, $5)",
        params![lib_id, "Test Lib", "movies", "/tmp/x", shared.clone()],
    )
    .await
    .expect("insert library");

    let lib = pool
        .fetch_one_as::<MediaLibraryFull>(
            "SELECT * FROM media.libraries WHERE id = $1",
            params![lib_id],
        )
        .await
        .expect("select library");
    assert_eq!(lib.shared_user_ids, shared, "JSON UUID array round-trips");
    assert_eq!(lib.item_count, 0, "default int column");
    assert_eq!(lib.source_type, "filesystem", "default text column");

    // ── 2. A movie with a JSON string-array (genres) and an f64 rating ────────
    let movie_id = new_id();
    let file_path = format!("/tmp/{movie_id}.mkv");
    let genres = vec!["Action".to_string(), "Sci-Fi".to_string()];
    pool.execute(
        "INSERT INTO media.movies (id, library_id, file_path, title, genres, vote_average) \
         VALUES ($1, $2, $3, $4, $5, $6)",
        params![movie_id, lib_id, file_path, "The Film", genres.clone(), 7.5f64],
    )
    .await
    .expect("insert movie");

    let movie = pool
        .fetch_one_as::<Movie>(
            "SELECT * FROM media.movies WHERE id = $1",
            params![movie_id],
        )
        .await
        .expect("select movie");
    assert_eq!(movie.genres, genres, "JSON string array round-trips");
    assert_eq!(movie.vote_average, Some(7.5), "f64 rating round-trips");
    assert!(movie.production_countries.is_empty(), "JSON array default is empty");

    // ── 3. Portable COUNT decoded as i64 ─────────────────────────────────────
    let count: i64 = pool
        .fetch_scalar::<i64>(
            &format!(
                "SELECT {} FROM media.movies WHERE library_id = $1",
                pool.backend().count_bigint("*")
            ),
            params![lib_id],
        )
        .await
        .expect("count movies");
    assert_eq!(count, 1, "count_bigint decodes as i64");

    // ── 4. Portable upsert (insert, then update the same key) ────────────────
    let user_id = new_id();
    let upsert = pool.backend().upsert(
        "media.video_progress",
        &["user_id", "item_type", "item_id"],
        &[Assign::Incoming("position_secs")],
    );
    let sql = format!(
        "INSERT INTO media.video_progress (user_id, item_type, item_id, position_secs) \
         VALUES ($1, $2, $3, $4){upsert}"
    );
    pool.execute(&sql, params![user_id, "movie", movie_id, 10i32])
        .await
        .expect("upsert insert");
    pool.execute(&sql, params![user_id, "movie", movie_id, 99i32])
        .await
        .expect("upsert update");

    let pos: i32 = pool
        .fetch_scalar::<i32>(
            "SELECT position_secs FROM media.video_progress \
             WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
            params![user_id, "movie", movie_id],
        )
        .await
        .expect("select progress");
    assert_eq!(pos, 99, "upsert updated the existing row");
}

#[tokio::test]
async fn sqlite_from_the_one_binary() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut s = base_settings("sqlite");
    s.path = Some(dir.path().to_string_lossy().into_owned());
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}

#[tokio::test]
async fn postgres_from_the_one_binary() {
    let Ok(url) = std::env::var("KUBUNO_PG_TEST_URL") else {
        eprintln!("skipping: KUBUNO_PG_TEST_URL not set");
        return;
    };
    let mut s = base_settings("postgres");
    s.url = Some(url);
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}

#[tokio::test]
async fn mysql_from_the_one_binary() {
    let Ok(url) = std::env::var("KUBUNO_MYSQL_TEST_URL") else {
        eprintln!("skipping: KUBUNO_MYSQL_TEST_URL not set");
        return;
    };
    let mut s = base_settings("mysql");
    s.url = Some(url);
    let (pool, _keep) = migrated_pool(s).await;
    full_suite(&pool).await;
}
