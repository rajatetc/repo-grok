# RepoGrok

AI-powered codebase explainer. Paste a GitHub URL and get an interactive overview, tech stack breakdown, repo health metrics, and a chat interface to ask questions about any JS/TS codebase.

<img width="800" height="520" alt="demo" src="https://github.com/user-attachments/assets/2fb7fdb6-b39c-4b0a-bc28-6715528e632a" />

## Contents

- [Live](#live)
- [Architecture](#architecture)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Run](#run)
- [Features](#features)
- [Example repos](#example-repos)
- [API](#api)
- [Project docs](#project-docs)
- [Deployment](#deployment)
- [Tech stack](#tech-stack)
- [License](#license)

## Live

- **App:** https://repo-grok.vercel.app
- **API:** https://repo-grok.onrender.com (`/health` for status)

## Architecture

```
Ingest (once per repo)
─────────────────────────────
GitHub zip
   → Babel AST → semantic chunks
   → Cloudflare embed (bge-small-en-v1.5, 384-dim)
   → in-memory vector store

Query (per question)
─────────────────────────────
question
   → Cloudflare embed
   → cosine similarity over stored chunks
   → top 8 chunks  +  question
   → Gemini Flash
   → SSE stream to UI
```

## How it works

1. Downloads the repo as a zip via GitHub API (one HTTP call)
2. Parses files into semantic chunks — functions, components, hooks, classes, types — using Babel AST
3. Converts chunks to 384-dim vector embeddings via Cloudflare Workers AI (`bge-small-en-v1.5`) — free tier, no LLM quota used
4. On each question, retrieves the most relevant chunks via cosine similarity and sends only those to Gemini — not the whole codebase (RAG)

## Prerequisites

- Node.js 22+
- A free [Gemini API key](https://aistudio.google.com/apikey) — only needed for chat, not for indexing
- A [Cloudflare Workers AI](https://dash.cloudflare.com/) account (free tier) — for embedding during ingestion
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
| `CLOUDFLARE_ACCOUNT_ID` | For indexing | From Cloudflare dashboard |
| `CLOUDFLARE_AI_TOKEN` | For indexing | Workers AI API token |
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
- **Chat** — ask anything about the codebase; multi-turn with history so follow-up questions have context
- **Dark mode** — follows system preference, manual toggle persisted in localStorage

## Example repos

These ship pre-baked (embedded at build time) so the example chips on the landing page open instantly.

| Repo | Good questions |
|------|----------------|
| [`reduxjs/redux`](https://github.com/reduxjs/redux) | How does createStore work? How does middleware compose? |
| [`expressjs/express`](https://github.com/expressjs/express) | How does the routing layer work? How is middleware chained? |
| [`axios/axios`](https://github.com/axios/axios) | How are interceptors implemented? How does cancellation work? |
| [`pmndrs/zustand`](https://github.com/pmndrs/zustand) | How does the store work? What patterns does it use? |
| [`colinhacks/zod`](https://github.com/colinhacks/zod) | What are the main exports? How does schema composition work? |

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/repos` | Ingest a GitHub repo (SSE streamed progress) |
| `POST` | `/api/repos/:id/query` | Ask a question (SSE streamed answer) |
| `GET` | `/health` | Health check |

## Project docs

- [`NOTES.md`](./NOTES.md) — architectural decisions and the reasoning behind them
- [`IDEAS.md`](./IDEAS.md) — future features and upgrade paths

## Deployment

The live app runs on free tiers across three services:

### Backend → Render

- **Type:** Web Service (free, 512MB, 0.1 CPU)
- **Root directory:** `server`
- **Build command:** `npm install && npm run build`
- **Start command:** `NODE_ENV=production npm start`
- **Auto-deploys** on push to `main`

**Environment variables (Render dashboard):**

| Key | Notes |
|-----|-------|
| `GEMINI_API_KEY` | Required for chat |
| `CLOUDFLARE_ACCOUNT_ID` | Required for indexing |
| `CLOUDFLARE_AI_TOKEN` | Required for indexing |
| `GITHUB_TOKEN` | Optional but recommended (60→5000 req/hr) |
| `CLIENT_URL` | Vercel URL, for CORS |

`NODE_ENV` is set only at runtime in the start command — keeping it out of the dashboard so `npm install` still picks up devDependencies during the build step.

### Frontend → Vercel

- **Framework preset:** Vite (auto-detected)
- **Root directory:** `client`
- **Auto-deploys** on push to `main`

**Environment variable (Vercel dashboard):**

| Key | Value |
|-----|-------|
| `VITE_API_URL` | The Render backend URL |

### Keepalive → cron-job.org

Render's free tier sleeps the service after 15 minutes of idle traffic, and a cold start takes ~10–15s. A free cron-job.org cron pings `/health` every 14 minutes (`*/14 * * * *`) so the server stays warm.

Render's free monthly budget is 750 hours — continuous uptime is 720, so a single always-warm service stays under the cap.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| AST parsing | Babel (`@babel/parser`, `@babel/traverse`) |
| Embeddings | Cloudflare Workers AI — `bge-small-en-v1.5` (384-dim, free tier) |
| LLM | Gemini 2.5 Flash (free tier) |
| Vector search | In-memory cosine similarity |
| GitHub API | Octokit + direct zipball download |

## License

MIT
