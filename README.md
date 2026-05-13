# RepoGrok

AI-powered codebase explainer. Paste a GitHub URL and get an interactive overview, architecture summary, and a chat interface to ask questions about any JS/TS codebase.

## How it works

1. Fetches all JS/TS files from a public GitHub repo
2. Parses files into semantic chunks (functions, components, hooks, classes, types) using Babel AST
3. Converts chunks to vector embeddings via Gemini
4. On each question, retrieves the most relevant chunks via cosine similarity and sends only those to the LLM — not the whole codebase

## Prerequisites

- Node.js 18+
- A free [Gemini API key](https://aistudio.google.com/apikey)
- A GitHub personal access token (optional — raises rate limit from 60 to 5000 req/hr)

## Setup

```bash
# Install server dependencies
cd server && npm install

# Copy env template and fill in your keys
cp .env.example .env
```

`.env` fields:

| Key | Required | Description |
|-----|----------|-------------|
| `GEMINI_API_KEY` | Yes | From aistudio.google.com |
| `GITHUB_TOKEN` | No | GitHub PAT with `public_repo` read scope |

## Run

```bash
# Development
cd server && npm run dev
```

Server runs on `http://localhost:3001`.

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/repos` | Ingest a GitHub repo |
| `GET` | `/api/repos/:id/overview` | Get repo overview + tech stack |
| `POST` | `/api/repos/:id/query` | Ask a question about the repo |
| `POST` | `/api/repos/:id/change-guide` | Describe a change, get file-level guidance |

## Tech stack

- **Backend:** Node.js + Express + TypeScript
- **AST parsing:** Babel
- **Embeddings + LLM:** Gemini (`text-embedding-004` + `gemini-2.0-flash`)
- **Vector search:** In-memory cosine similarity
- **GitHub API:** Octokit
