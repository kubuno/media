/// The database namespace this module owns (PostgreSQL schema, MySQL database,
/// or the ATTACHed SQLite file). Passed to `kubuno_db::connect`/`migrations!`.
pub const SCHEMA: &str = "media";

pub mod config;
pub mod errors;
pub mod events;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod router;
pub mod services;
pub mod state;
pub mod workers;
