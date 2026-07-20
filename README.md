<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Kubuno Media

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)

**Kubuno Media — Watch (films/séries) et Listen (musique)**

A module for [Kubuno](https://github.com/kubuno/core), the self-hosted, libre (AGPLv3) cloud platform.

## Features

### Watch — movies & TV shows

- **Library scanning** — point the module at your video folders; a filesystem watcher indexes new files as they arrive, and filenames are parsed into title/year for matching.
- **Home page** — a streaming-style landing page with a hero banner (resume watching or latest addition) and horizontal rows: *Continue watching*, *Recently added*, *TV shows*, *My list*.
- **Movie & show detail pages** — backdrop hero, synopsis, cast, genres, networks, multi-source ratings, trailers; TV shows get season pills and a full episode list with thumbnails, and episodes are directly playable.
- **My list** — a personal watchlist mixing movies and shows.
- **Playback** — in-app floating video player with HLS transcoding and resume positions.

### Live TV

- A curated set of built-in channels, limited to broadcasters that openly publish their own free live streams (public and international news services) — no third-party or pay-TV streams.
- Add your own channels (HLS URLs) and discover more through the iptv-org community catalogue.
- Same-origin HLS proxy: manifests are rewritten server-side so playback works without CORS or mixed-content issues, with SSRF guards on proxied URLs.
- Favorites, recents and category filters, mirroring the web-radio experience.

### Metadata engine

- **Multi-provider enrichment** pipeline running in the background: TMDB (official API key supported, with a keyless fallback), TVMaze, Wikidata/Wikipedia (localized descriptions), OMDb (Rotten Tomatoes, IMDb and Metacritic ratings), MusicBrainz + Cover Art Archive, TheAudioDB and Deezer for music.
- **Manual identification** — an *Identify* dialog searches every relevant provider, shows multiple candidates (poster, source, score) and lets you pick the right match; external IDs are persisted so refreshes re-match by ID, not by title.
- **Local metadata first** — standard `.nfo` files are honored (including `lockdata`), album folder art (`cover.jpg`, `folder.jpg`…) beats embedded art, which beats remote providers; embedded audio tags feed artists/albums/track numbers.
- **Metadata lock** — lock any item to protect curated metadata from refreshes.
- Failed lookups are retried with backoff, and per-item refresh/dissociate is available from every detail page.

### Listen — music, radio & DJ

- Artists, albums and tracks with rich detail views, localized biographies and cover art.
- A full-featured player: queue, equalizer, visualizer, floating mini-player.
- **Web radio** with a curated catalogue of stations that openly publish their streams.
- **DJ console** — up to six decks with hardware-style jog wheels, faders and pads, hot cues, key/BPM analysis and a mobile-friendly stacked layout.
- Playback counts as user activity: sessions are kept awake while something is playing.

Settings are split between per-user preferences and admin configuration (libraries, provider API keys), all editable from the UI.

## Architecture

A standalone Rust process that registers with the [core](https://github.com/kubuno/core) at startup; the core proxies its routes (`/api/v1/media/*`) and serves its runtime-loaded React frontend bundle.

- **Backend** — `src/`: Axum + SQLx (PostgreSQL, schema `media`); migrations in `migrations/`.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@kubuno/ui` and `@kubuno/drive` from npm (provided by the host at runtime via the import map).

## Install

This module ships in the **all-in-one [Kubuno](https://github.com/kubuno/core) Docker image** (`ghcr.io/kubuno/kubuno`) — the easiest way to self-host a full Kubuno instance (core + every module). See **[kubuno/docker](https://github.com/kubuno/docker)** for `docker compose` instructions.

Native packages are also built for every tagged release and attached to the [GitHub Releases](https://github.com/kubuno/media/releases):

- **Debian/Ubuntu** — `kubuno-media_*.deb`
- **Fedora/RHEL/openSUSE** — `kubuno-media-*.rpm`
- **Windows** — `kubuno-media-setup-*-x64.exe` (installs into an existing Kubuno core installation)
- **macOS** — `kubuno-media-*.pkg`

To build this module from source, see below.

## Build

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, PostgreSQL 16.

```bash
cargo build --release                     # → target/release/kubuno-media
cd frontend && npm ci && npm run build     # → dist/{entry.js, entry.css}
bash build_deb.sh                          # → dist/kubuno-media_*.deb
```

Platform-specific packages use the same auto-detecting layout: `build_rpm.sh` (RPM), `build_windows.sh` (NSIS installer, cross-compilable from Linux with cargo-xwin) and `build_macos.sh` (`.pkg`, to be run on a Mac).

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui`, `@kubuno/drive` from the `@kubuno` npm scope.

## License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
