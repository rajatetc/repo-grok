# RepoGrok

AI-powered codebase explainer. Paste a GitHub URL and get an interactive overview, tech stack breakdown, repo health metrics, and a chat interface to ask questions about any JS/TS codebase.

## How it works

1. Downloads the repo as a zip via GitHub API (one HTTP call)
2. Parses files into semantic chunks — functions, components, hooks, classes, types — using Babel AST
3. Converts chunks to vector embeddings locally via `all-MiniLM-L6-v2` (no API quota)
4. On each question, retrieves the most relevant chunks via cosine similarity and sends only those to Gemini — not the whole codebase (RAG)

## Prerequisites

- Node.js 18+
- A free [Gemini API key](https://aistudio.google.com/apikey) — only needed for chat, not for indexing
- A GitHub personal access token (optional — raises API rate limit from 60 to 5000 req/hr)

## Setup

```bash
# Server
cd server && npm install
cp .env.example .env   # fill in your keys

# Client
cd client && npm install
```

### Environment variables

**`server/.env`**

| Key | Required | Description |
|-----|----------|-------------|
| `GEMINI_API_KEY` | For chat | From aistudio.google.com — not needed for indexing |
| `GITHUB_TOKEN` | Recommended | GitHub PAT with `public_repo` read scope |
| `CLIENT_URL` | Prod only | Frontend origin for CORS (default: `http://localhost:5173`) |

**`client/.env`** (create if deploying)

| Key | Description |
|-----|-------------|
| `VITE_API_URL` | Backend URL (default: `http://localhost:3001`) |

## Run

```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend
cd client && npm run dev
```

Frontend: `http://localhost:5173` · Backend: `http://localhost:3001`

## Features

- **Overview tab** — file count, lines of code, dependencies, tech stack badges, collapsible folder tree
- **Pulse tab** — live GitHub data: stars, forks, last push, open issues, open PRs, top contributors
- **Chat** — ask anything about the codebase; answers are grounded in actual source chunks
- **Dark mode** — follows system preference, manual toggle persisted in localStorage

## Example repos

| Repo | Good questions |
|------|----------------|
| [`reduxjs/redux`](https://github.com/reduxjs/redux) | How does createStore work? How does middleware compose? |
| [`axios/axios`](https://github.com/axios/axios) | How are interceptors implemented? How does cancellation work? |
| [`colinhacks/zod`](https://github.com/colinhacks/zod) | How does schema parsing work? How are errors collected? |
| [`pmndrs/zustand`](https://github.com/pmndrs/zustand) | How is the store created? How does the React binding work? |
| [`immerjs/immer`](https://github.com/immerjs/immer) | How does produce() work? How are drafts tracked? |

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/repos` | Ingest a GitHub repo |
| `GET` | `/api/repos/:id/overview` | Repo metadata + tech stack |
| `POST` | `/api/repos/:id/query` | Ask a question (SSE streamed) |
| `GET` | `/health` | Health check |

## Project docs

- [`NOTES.md`](./NOTES.md) — architectural decisions and the reasoning behind them
- [`IDEAS.md`](./IDEAS.md) — future features and upgrade paths

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| AST parsing | Babel (`@babel/parser`, `@babel/traverse`) |
| Embeddings | `@xenova/transformers` — `all-MiniLM-L6-v2`, runs locally |
| LLM | Gemini 2.0 Flash (free tier) |
| Vector search | In-memory cosine similarity |
| GitHub API | Octokit + direct zipball download |

## License

MIT
