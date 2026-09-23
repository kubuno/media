<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

<div align="center">

<img src=".github/logo-listen.png" alt="Kubuno Media logo" width="120">

# Kubuno — Media

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Database](https://img.shields.io/badge/database-PostgreSQL%20%7C%20MySQL%20%7C%20SQLite-336791.svg)
![Status](https://img.shields.io/badge/status-alpha-yellow.svg)
![Kubuno module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)

**Your self-hosted media library for Kubuno — Watch films and TV shows, Listen to your music, radio and DJ sets, all served from your own storage.**

A module for [Kubuno](https://github.com/kubuno/core), the self-hosted, libre (AGPLv3) cloud platform — a sovereign alternative to the mainstream productivity suites.

</div>

---

## Screenshots

<!-- SCREENSHOTS -->

## Apps

Media brings two apps to the platform, each with its own entry in the app launcher:

<table>
  <thead>
    <tr>
      <th width="52"></th>
      <th align="left">App</th>
      <th align="left">Path</th>
      <th align="left">What it does</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"></td>
      <td><b>Watch</b></td>
      <td><code>/media/watch</code></td>
      <td>Films, TV shows and live TV</td>
    </tr>
    <tr>
      <td align="center"><img src=".github/logo-listen.png" width="24" height="24" alt=""></td>
      <td><b>Listen</b></td>
      <td><code>/media/listen</code></td>
      <td>Music, web radio and a DJ console</td>
    </tr>
  </tbody>
</table>

## Features

### Watch — movies & TV shows

- **Library scanning** — point the module at your video folders; a filesystem watcher indexes new files as they arrive, and filenames are parsed into title/year for matching. A configurable full rescan catches files added out of band.
- **Streaming-style home** — a landing page with a hero banner (resume watching or latest addition) and horizontal rows: *Continue watching*, *Recently added*, *TV shows*, *My list*.
- **Movie & show detail pages** — backdrop hero, synopsis, cast, genres, networks, multi-source ratings and trailers; TV shows get season pills and a full episode list with thumbnails, all directly playable.
- **My list & resume** — a personal watchlist mixing movies and shows, and resume positions carried across devices.
- ▶ **Playback** — an in-app floating video player with HLS transcoding, with classic window glyphs (expand, reduce, fullscreen).
- **Parental controls** — an instance-wide age limit applied to playback, listings, detail pages and search, with optional blocking of unrated content (administrators are never restricted, so they can verify what they configure).

### Live TV

- A curated set of built-in channels, limited to broadcasters that openly publish their own free live streams (public and international news services) — no third-party or pay-TV streams.
- Add your own channels (HLS URLs) and discover more through the iptv-org community catalogue.
- A same-origin HLS proxy rewrites manifests server-side so playback works without CORS or mixed-content issues, with SSRF guards on proxied URLs.
- Favorites, recents and category filters, mirroring the web-radio experience.

### Listen — music, radio & DJ

- Artists, albums and tracks with rich detail views, localized biographies and cover art.
- A full-featured player: queue, equalizer, visualizer and a floating mini-player, with the title bar staying legible even at minimum window width.
- **Web radio** with a curated catalogue of stations that openly publish their streams.
- **DJ console** — up to six decks with hardware-style jog wheels, faders and pads, hot cues, key/BPM analysis and a mobile-friendly stacked layout.
- ⏱ Playback counts as user activity, so sessions are kept awake while something is playing.

### Metadata engine

- **Multi-provider enrichment** running in the background: TMDB (official API key supported, with a keyless fallback), TVMaze, Wikidata/Wikipedia (localized descriptions), OMDb (Rotten Tomatoes, IMDb and Metacritic ratings), MusicBrainz + Cover Art Archive, TheAudioDB and Deezer for music.
- **Manual identification** — an *Identify* dialog searches every relevant provider, shows multiple candidates (poster, source, score) and lets you pick the right match; external IDs are persisted so refreshes re-match by ID, not by title.
- **Local metadata first** — standard `.nfo` files are honored (including `lockdata`), album folder art (`cover.jpg`, `folder.jpg`…) beats embedded art, which beats remote providers; embedded audio tags feed artists/albums/track numbers.
- **Metadata lock** — lock any item to protect curated metadata from refreshes; failed lookups are retried with backoff, and per-item refresh/dissociate is available from every detail page.

Settings are split between per-user preferences and admin configuration (libraries, provider API keys, parental controls, rescan cadence), all editable from the UI.

## Architecture

Media is a **separate process** (a standalone Rust binary listening on port **3113**) that registers with the [core](https://github.com/kubuno/core) at startup. The core proxies its routes (`/api/v1/media/*`), distributes platform events to it and manages its lifecycle; it also serves the module's runtime-loaded React frontend bundle through the host import map.

- **Backend** — `src/`: Axum on the shared `kubuno-db` layer, running on **PostgreSQL, MySQL/MariaDB or SQLite** (the engine is an administrator choice read at run time — one binary, no rebuild), in a dedicated `media` schema; migrations in `migrations/`. Video transcoding (HLS) runs through FFmpeg. Proxied requests are authenticated from a signed `X-Kubuno-Auth` token minted by the core, never from plain forwarded headers.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@kubuno/ui` (`@ui`) and `@kubuno/drive` from npm — resolved by the host at runtime via the import map, never re-bundled.

## Install

A Kubuno module is distributed as a single **`.kbpkg`** — a portable package that the Kubuno server installs by itself, the same file on Linux, Windows and macOS. It is not a system service and ships in no other format.

The easiest way to self-host a full Kubuno instance (core + every module) is the all-in-one **Docker image** (`ghcr.io/kubuno/kubuno`); see **[kubuno/docker](https://github.com/kubuno/docker)**. To install Media into an existing instance, grab the `.kbpkg` from the [GitHub Releases](https://github.com/kubuno/media/releases) and let the core unpack it — from the admin console's module marketplace, or offline from the CLI:

```bash
sudo kubuno modules:install kubuno-media-<version>-<os>-<arch>.kbpkg
sudo systemctl restart kubuno            # the core loads the module on (re)start
```

## Build & development

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, and a database: PostgreSQL 16, MySQL/MariaDB or SQLite.

```bash
cargo build --release                      # → target/release/kubuno-media
cd frontend && npm ci && npm run build      # → dist/{entry.js, entry.css}
bash build_kbpkg.sh                          # → dist/media-<version>-<os>-<arch>.kbpkg
bash build_kbpkg.sh --install               # build, install into the module store and restart
```

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui`, `@kubuno/drive` from the `@kubuno` npm scope.

## Tech stack

Rust 2021 · Axum · Tokio · `kubuno-db` over SQLx (PostgreSQL, MySQL/MariaDB or SQLite) — React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · React Query · HLS.

## Contributing

Contributions are welcome. Please open an issue to discuss any significant change before submitting a pull request.

## License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
