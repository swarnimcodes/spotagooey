# AGENTS.md

## Project

A desktop Spotify client built with Tauri v2 (Rust backend) + React/TypeScript frontend. Independent codebase — not a fork of spotatui. Spot atui was the inspiration for the feature set, but this project reimplements the backend from scratch on its own dependencies.

## Design direction

The UI must follow an **Apple Music–like aesthetic** — polished, clean, and minimalist. It is **not** meant to mirror Spotify's visual design.

Guiding principles:

- Clean, spaced-out layout with generous whitespace; avoid dense, cluttered panels.
- Muted, elegant color palette with subtle depth (soft shadows, faint gradients, translucency/backdrop blur where tasteful).
- Beautiful album art treatment: large, rounded-corner artwork, soft drop shadows, smooth transitions on hover.
- Minimal chrome: thin, unobtrusive controls; rely on animation and imagery rather than heavy borders or contrast.
- Tasteful motion: smooth eased transitions and micro-interactions, never flashy.
- Typography follows Apple Music's calm, modern feel; system fonts are fine.
- Personal library, playlists, and player controls should feel at home in this aesthetic — like an elegant music app, not a utilitarian dashboard.

## Stack

- Tauri v2 (Rust core: Spotify auth, Web API client, optional librespot streaming)
- React + TypeScript + Vite frontend
- Playback: Web API control mode first; librespot native streaming optional (Premium, subject to Spotify-side `audio key 0 1` limitations)

## Config & auth

- Config lives in `~/.config/spotagooey/client.yml` (see `src-tauri/src/config.rs`).
- Fields: `client_id`, `redirect_uri`, `port`, `token` (cached OAuth token, saved after login, cleared on logout).
- `SPOTIFY_CLIENT_ID` env var overrides `client_id` for dev convenience.
- First-run setup is done in the GUI: login screen has a guided form to paste the Client ID (saved via the `set_client_id` command); no env vars needed by end users.
- PKCE OAuth, callback server on port 8431, redirect URI `http://127.0.0.1:8431/callback`.

## Commands

- Use pnpm exclusively for JavaScript dependencies and scripts. Do not use npm or commit `package-lock.json`.
- `pnpm install` — install frontend dependencies
- `pnpm run tauri dev` — run the app
- `pnpm run tauri build` — build a distributable
- `cargo build` in `src-tauri/` — compile Rust backend only
