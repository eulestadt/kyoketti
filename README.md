# Kyoketti

A web Obsidian-style markdown vault that stores notes in your Google Drive.

## Features

- **Link Google Drive** as the first screen
- Pick or create a Drive folder as your vault
- File explorer with create / rename / delete (moves to Drive trash)
- Markdown editor with source, live preview, and reading modes
- `[[wiki links]]`, tags, backlinks, outline, and graph view
- Quick switcher (`Ctrl/Cmd+O`) and vault search
- Autosave back to Google Drive

## Setup

1. Create a Google Cloud project
2. Enable **Google Drive API**
3. Configure OAuth consent screen
4. Create an **OAuth 2.0 Web Client ID**
5. Add your local origin (e.g. `http://localhost:5173`) to Authorized JavaScript origins
6. Copy `.env.example` to `.env` and set:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=optional-api-key
```

7. Install and run:

```bash
npm install
npm run dev
```

The first screen asks you to **Link Google Drive**. You can also use **Try a local demo vault** to explore the Obsidian-like UI without Google credentials.
## Scripts

- `npm run dev` — local development server
- `npm run build` — production build
- `npm run preview` — preview production build

## Notes

Kyoketti requests Google Drive access so it can read and write markdown files in the vault folder you choose. Tokens are kept in `localStorage` for the browser session lifetime of the access token.
