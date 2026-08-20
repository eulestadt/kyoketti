# Kyoketti

A web markdown vault with Google Drive, GitHub, local folder, and demo backends.

## Features

- Connect with Google, GitHub, or a local folder
- Pick or create a vault (Drive folder or GitHub repo)
- File explorer with create / rename / delete
- Markdown editor: source, live preview, WYSIWYG, reading, pure editor
- `[[wiki links]]`, tags, backlinks, outline, and graph view
- Quick switcher (`Ctrl/Cmd+O`), command palette (`Ctrl/Cmd+P`), and vault search
- Autosave (Drive writes or GitHub commits)
- Works offline in the browser (app shell + last-synced vault, with sync when you are back online)

## Setup

1. Create a Google Cloud project (for Drive) and/or a GitHub OAuth App
2. Configure Worker secrets (never commit these):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
   - `SESSION_SECRET`, optional `APP_ORIGIN`
3. Copy `.env.example` to `.env` for any local Vite vars
4. Install and run:

```bash
npm install
npm run dev
```

You can also use **Try a demo vault** without cloud credentials. After the first successful load, reload while offline to keep working from the cached app and vault.

## Scripts

- `npm run dev` — local development server
- `npm run build` — production build
- `npm run preview` — preview production build

## Deploy

Production auth/API runs on Cloudflare Workers (`kyoketti.phoenix.boston`).

```bash
npm run build
npx wrangler deploy
```
