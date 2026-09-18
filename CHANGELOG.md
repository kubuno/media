# Changelog

All notable changes to **kubuno-media** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/). Entries are added under
`[Unreleased]` **as the change is made**; `_tools/release.sh` stamps them under the version
number at release time, and CI publishes that section as the GitHub Release notes.

## [Unreleased]

### Security

- **TLS library updated to a patched release.** The pinned `rustls` carried
  RUSTSEC-2026-0285 (medium). Every outbound HTTPS connection goes through it.

## [0.1.7] - 2026-09-18

### Changed


- **This module now installs as a Kubuno package (`.kbpkg`) only.** Its system
  packages (Debian/RPM and the Windows and macOS installers) are no longer
  built: the module is distributed as one `.kbpkg` per platform (Linux, Windows,
  macOS) that the Kubuno server installs itself — from the admin console, or
  offline with `kubuno modules:install <file>.kbpkg`.
- **The README now opens with a logo, and the Listen section carries its own.**
  The Listen heading shows the Listen artwork used by the applications menu and
  the browser tab. Media itself has no module artwork yet, so the page opens on
  the Kubuno crest as a stand-in.

- **New Listen logo** — a green hexagon with a white loudspeaker, used as the
  browser-tab icon of `/media/listen` and in the applications menu. It
  replaces the generic music-note icon and is raster (PNG) designer artwork.

- **Classic window glyphs on the floating video player, music player and TV.**
  Expand is a plain square, reduce two overlapping squares, and fullscreen the
  corner icons — no more diagonal double arrows.




### Fixed

- **The floating players' title bar no longer balloons on a narrow window.**
  A long track or file name — "Parle-moi (feat. Zaho)" — used to wrap onto four
  lines and turn the accent band into a block three times its height, because
  the band's six action buttons leave the title only a few dozen pixels at the
  minimum window width. The title now stays on a single line and gives way as
  room runs out: the icon goes first, then the text is ellipsised, and it drops
  entirely when nothing legible would fit. Applies to the music player, the
  Drive video player and the trailer window; the name is still shown in full in
  each window's body.

- **A withdrawn dependency is no longer used.** A crate deep in the tree
  (`spin` 0.9.8, pulled in through the HTTP stack) was yanked by its authors.
  No vulnerability was announced, but a withdrawn crate has no business in a
  release; the lockfile now takes the version that replaced it.
- **The package could not be built where `zip` is absent.** The Windows job of
  the continuous integration has no `zip`, so the Windows package was simply lost
  the first time it was attempted — a script failure, not a build failure. The
  builder now falls back to 7-Zip, then to PowerShell.
### Added

- **This module now ships a `.kbpkg`** — the single package format a Kubuno
  server installs by itself, the same file on Linux, Windows and macOS. It
  carries the same binary, interface and manifest as the system packages,
  arranged the way the server expects to find a module on disk, plus a
  `SHA256SUMS` so a copy carried offline can be checked without the catalogue.
  Nothing changes for existing installations: the `.deb`, `.rpm`, `.exe` and
  `.pkg` are still published, and a catalogue that sees both simply prefers the
  new one. It is also the only format the server can unpack without an external
  tool, which is what makes one-click installation possible away from
  Debian-like systems.
### Fixed

- **A built package could be thrown away instead of published.** The job that
  attaches a package to the release waited ten minutes for another workflow to
  create that release, then gave up with "release never appeared — build.yml
  likely failed". The diagnosis was wrong: on a repository whose `.deb` takes
  longer than ten minutes to build, the release simply did not exist yet, and a
  package that had built perfectly was discarded. Four modules reached v0.1.6
  with packages missing for some systems because of it. The job now creates the
  release itself when it is missing, so it no longer depends on another workflow
  finishing first.
### Added

- **Security policy and CI quality gate.** A `SECURITY.md` documents how to
  report vulnerabilities, and a CI workflow enforces `clippy -D warnings`, a
  dependency-vulnerability audit (`cargo audit`) and the frontend typecheck/tests.

### Security

- **Media now authenticates proxied requests from a signed token instead of
  trusting plain headers.** Requests must carry a valid `X-Kubuno-Auth` token
  minted by the core with this module's internal secret (see `kubuno-modauth`),
  rather than reading `X-Kubuno-User-*` headers at face value — which any process
  reaching Media's loopback port could otherwise forge to act as any user.

## [0.1.6] - 2026-08-19

### Changed

- **Pill-shaped buttons are gone from the interface.** Filter chips, view
  segments, tab selectors and action buttons that were drawn as pills now use the
  same 4 px corner radius as every other button — the shape set them apart for no
  reason other than habit. Round buttons that hold a lone icon, avatars, status
  dots and non-clickable badges keep their shape: a circle around a single glyph
  is not a pill.

- Theme tokens: two colours for navigation labels (`--color-text-nav`,
  `--color-text-nav-active`). Every module carries the same token sheet, so the
  values must match across them — whichever bundle loads last would otherwise
  win. No visible change inside this module.

### Changed

- Default application background token aligned with the core (`--body-bg` `#f8fafd`). Only
  visible when the module runs standalone: inside the shell the active theme sets it.

[Unreleased]: https://github.com/kubuno/media/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/kubuno/media/releases/tag/v0.1.7
[0.1.6]: https://github.com/kubuno/media/releases/tag/v0.1.6
