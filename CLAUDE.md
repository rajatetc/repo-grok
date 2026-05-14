# RepoGrok — AI-Powered Codebase Explainer

## What is this?
A web app that helps developers understand unfamiliar codebases. Paste a GitHub URL and get an interactive overview, live repo health metrics, and a chat interface to ask questions about any JS/TS codebase using RAG.

## Core User Flow
1. User pastes a public GitHub repo URL
2. App downloads the repo as a zip (one HTTP call via Octokit)
3. Files are parsed into an AST using Babel, chunked by semantic boundaries (functions, classes, components, hooks, types)
4. Chunks are converted to vector embeddings locally via `all-MiniLM-L6-v2` (no API quota used)
5. Embeddings stored in-memory with cosine similarity search
6. Overview tab: tech stack detection, folder structure, file/LOC stats
7. Pulse tab: live GitHub data (stars, forks, issues, PRs, contributors) fetched client-side
8. User can ask questions → RAG retrieves relevant chunks → sends only those to Gemini LLM → streams response

## Tech Stack
- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript
- **AST Parser:** Babel (`@babel/parser`, `@babel/traverse`) for semantic chunking
- **Embeddings:** `@xenova/transformers` — `all-MiniLM-L6-v2`, runs locally, zero API cost
- **LLM:** Gemini 2.0 Flash (free tier) — only used for chat answers
- **Vector Search:** In-memory cosine similarity
- **GitHub API:** Octokit + direct zipball download

## Architecture Pipeline

```
Repo URL → GitHub zipball → Babel AST Parser (chunk by fn/class/component)
→ Local embeddings (all-MiniLM-L6-v2) → In-memory Vector Store
→ User Query → Embed query → Cosine similarity (find top-k chunks)
→ Send relevant chunks + query to Gemini LLM → Stream response to UI
```

## Key Design Decisions

### Token Optimization
- Process repo ONCE during ingestion (parse → chunk → embed → store)
- Per query, only retrieve and send 5–10 relevant chunks to the LLM, NOT the whole codebase
- This is the RAG pattern

### Smart Chunking via AST
- Babel parses JS/TS files into AST
- Chunk by semantic units: functions, React components, custom hooks, classes, type definitions
- Large chunks split at logical boundaries (empty lines, closing braces)
- Fallback to line-based splitting if AST parsing fails
- Chunk types: component (PascalCase fns), hook (use* fns), function, class, type/interface

### Scope for MVP
- JS/TS repos only (React/frontend repos as primary target)
- Public GitHub repos only
- More languages via swapping parsers (see IDEAS.md)

### Tech Stack Detection
- Parse package.json to auto-detect frameworks, state management, styling, testing, build tools, backend libs (~80 packages in lookup table)
- Config file patterns as a second signal (e.g. `tailwind.config.*`, `vite.config.*`, `schema.prisma`)

### GitHub Repo Fetching
- Download full repo as a zip (one HTTP call) — avoids N+1 API requests of per-file fetching
- Filter to `.js/.jsx/.ts/.tsx/.html/.css/.vue/.svelte` + `package.json`
- Ignore: `node_modules`, `dist`, `build`, `.next`, lock files — using path segment matching
- Skip files > 500KB (generated/minified); cap total extracted bytes at 150MB (zip bomb protection)
- 60s timeout on the download

### Repo Pulse
- Live GitHub data fetched directly from `api.github.com` on the client (no CORS issues, public endpoints)
- Fetched lazily — only when user clicks the Pulse tab, cached for the session (component stays mounted)
- No server proxy needed — avoids extra round-trip

## Project Structure
```
repo-grok/
├── server/
│   ├── src/
│   │   ├── services/
│   │   │   ├── github.ts       # Zipball downloader, URL parser, folder tree builder
│   │   │   ├── chunker.ts      # Babel AST chunker — semantic splitting
│   │   │   ├── embeddings.ts   # Local transformer model (all-MiniLM-L6-v2)
│   │   │   ├── vectorStore.ts  # In-memory cosine similarity search
│   │   │   ├── llm.ts          # Gemini Flash — streaming RAG answers
│   │   │   └── seeds.ts        # Pre-baked example repo loader
│   │   ├── utils/
│   │   │   └── techDetector.ts # Tech stack detection
│   │   ├── types/
│   │   │   └── index.ts        # Shared types
│   │   └── index.ts            # Express server + routes
│   ├── seeds/                   # Pre-baked example repos (committed JSON)
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── OverviewTab.tsx  # Stats, tech badges, folder tree
│   │   │   ├── PulseTab.tsx     # Live GitHub data (stars, issues, PRs, contributors)
│   │   │   └── ChatTab.tsx      # SSE-streamed chat
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx
│   │   │   └── RepoPage.tsx     # Two-column layout: sidebar tabs + chat
│   │   ├── hooks/
│   │   │   ├── useTheme.ts      # Dark mode — localStorage + system preference
│   │   │   └── useIngestionProgress.ts
│   │   └── store/
│   │       └── useRepoStore.ts  # Zustand — metadata, messages, Gemini key
│   ├── package.json
│   └── vite.config.ts
├── CLAUDE.md
├── NOTES.md
└── IDEAS.md
```

## API Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/repos` | Ingest a repo (rate-limited: 5/hr) |
| `GET` | `/api/repos/:id/overview` | Repo metadata + tech stack |
| `POST` | `/api/repos/:id/query` | RAG query, SSE streamed |
| `GET` | `/health` | Health check |

## Conventions
- TypeScript strict mode throughout
- ES modules
- Async/await over callbacks
- Descriptive variable names
- Error handling with try/catch at service boundaries
- No `any` types — use proper generics and type narrowing

## Git & Commit Rules
- **Separate commits for client and server** — never mix frontend and backend changes in one commit
- **Scope = code area**, not phase number or ticket. Use `client`, `server`, or a specific area like `chunker`, `llm`, `OverviewTab`
- **No Co-Authored-By lines** in commit messages
- Commit message format: `type(scope): short description`
  - Types: `feat`, `fix`, `refactor`, `style`, `chore`
  - Examples: `feat(client): add dark mode toggle`, `fix(server): cap zip extraction at 150MB`
- One concern per PR — don't bundle unrelated changes
- Confirm before pushing; never force-push main
