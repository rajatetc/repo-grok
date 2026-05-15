# RepoGrok — AI-Powered Codebase Explainer

## What is this?
A web app that helps developers understand unfamiliar codebases. Paste a GitHub URL and get an interactive overview, live repo health metrics, and a chat interface to ask questions about any JS/TS codebase using RAG.

## Core User Flow
1. User pastes a public GitHub repo URL
2. App downloads the repo as a zip (one HTTP call via Octokit)
3. Files are parsed into an AST using Babel, chunked by semantic boundaries (functions, classes, components, hooks, types)
4. Chunks are embedded via Cloudflare Workers AI (`bge-small-en-v1.5`, 384-dim) — free tier, no LLM quota used
5. Embeddings stored in-memory with cosine similarity search
6. Overview tab: tech stack detection, folder structure, file/LOC stats
7. Pulse tab: live GitHub data (stars, forks, issues, PRs, contributors) fetched client-side
8. User can ask questions → RAG retrieves relevant chunks → sends only those to Gemini LLM → streams response

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | React + TypeScript + Vite | |
| Backend | Node.js + Express + TypeScript | |
| AST Parser | Babel (`@babel/parser`, `@babel/traverse`) | Semantic chunking |
| Embeddings | Cloudflare Workers AI — `bge-small-en-v1.5` | 384-dim, free tier, remote API |
| LLM | Gemini 2.5 Flash (free tier) | Chat answers only |
| Vector Search | In-memory cosine similarity | Linear scan, ~10ms for <10k chunks |
| GitHub API | Octokit + direct zipball download | |

## Architecture Pipeline

```
Repo URL → GitHub zipball → Babel AST Parser (chunk by fn/class/component)
→ Cloudflare Workers AI embeddings (bge-small-en-v1.5) → In-memory Vector Store
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
### Chunk Types

| Type | Detection Rule |
|------|----------------|
| `component` | PascalCase exported functions returning JSX |
| `hook` | Functions starting with `use` |
| `function` | All other named functions |
| `class` | Class declarations |
| `type` | TypeScript type/interface declarations |

### Scope for MVP
- JS/TS repos only (React/frontend repos as primary target)
- Public GitHub repos only
- More languages via swapping parsers (see IDEAS.md)

### Tech Stack Detection
- Parse package.json to auto-detect frameworks, state management, styling, testing, build tools, backend libs (~80 packages in lookup table)
- Config file patterns as a second signal (e.g. `tailwind.config.*`, `vite.config.*`, `schema.prisma`)

### GitHub Repo Fetching

| Setting | Value | Reason |
|---------|-------|--------|
| Download method | Single zipball | Avoids N+1 per-file API calls |
| Allowed extensions | `.js/.jsx/.ts/.tsx/.html/.css/.vue/.svelte` + `package.json` | |
| Ignored paths | `node_modules`, `dist`, `build`, `.next`, `bench`, `benchmarks`, lock files | Path segment matching |
| Max file size | 500 KB | Skip generated/minified files |
| Max extracted bytes | 150 MB | Zip bomb protection |
| Download timeout | 60s | |

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
│   │   │   ├── github.ts         # Zipball downloader, URL parser, folder tree builder
│   │   │   ├── chunker.ts        # Babel AST chunker — semantic splitting
│   │   │   ├── embeddings.ts     # Cloudflare Workers AI (bge-small-en-v1.5)
│   │   │   ├── vectorStore.ts    # In-memory cosine similarity search
│   │   │   ├── lexicalSearch.ts  # BM25-style fallback when embed quota is exhausted
│   │   │   ├── seeds.ts          # Pre-baked example repos + canned-answer short-circuit
│   │   │   └── llm.ts            # Gemini Flash — streaming RAG answers
│   │   ├── utils/
│   │   │   ├── techDetector.ts   # Tech stack detection
│   │   │   └── normalizeUrl.ts   # Canonical URL form for dedup cache
│   │   ├── types/
│   │   │   └── index.ts          # Shared types
│   │   └── index.ts              # Express server + routes
│   ├── scripts/
│   │   └── prebake.ts            # Generates seed JSONs for the example repos
│   ├── seeds/                    # Pre-embedded example repos (committed JSON)
│   ├── fixtures/                 # Integration-test fixture repo
│   ├── package.json
│   └── tsconfig.json
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── OverviewTab.tsx   # Stats, tech badges, folder tree
│   │   │   ├── PulseTab.tsx      # Live GitHub data (stars, issues, PRs, contributors)
│   │   │   ├── ChatTab.tsx       # SSE-streamed chat
│   │   │   ├── ErrorBoundary.tsx # Top-level React error boundary
│   │   │   ├── ThemeToggle.tsx   # Reusable dark/light toggle button
│   │   │   └── Footer.tsx        # Shared footer (Built by · GitHub · LinkedIn · X)
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx
│   │   │   └── RepoPage.tsx      # Two-column layout: sidebar tabs + chat
│   │   ├── hooks/
│   │   │   ├── useTheme.ts             # Dark mode — localStorage + system preference
│   │   │   ├── useIngestionProgress.ts
│   │   │   └── usePulse.ts             # GitHub repo + issues + PRs + contributors fetcher
│   │   ├── api/
│   │   │   └── index.ts          # Fetch wrappers + SSE parsing for ingest/query
│   │   ├── utils/
│   │   │   └── format.ts         # timeAgo, fmtNum helpers
│   │   ├── store/
│   │   │   ├── useRepoStore.ts   # Zustand — repo metadata, chat messages, ingest status
│   │   │   └── useRecentRepos.ts # Recently-viewed repos, persisted in localStorage
│   │   ├── types/
│   │   │   └── index.ts          # Shared client types
│   │   └── constants.ts          # Client-wide constants (limits, URLs)
│   ├── package.json
│   └── vite.config.ts
├── CLAUDE.md
├── NOTES.md
└── IDEAS.md
```

## API Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/repos` | Ingest a repo, SSE streamed progress (rate-limited: 25/hr) |
| `POST` | `/api/repos/:id/query` | RAG query, SSE streamed answer |
| `GET` | `/health` | Health check |

## Conventions
- TypeScript strict mode throughout
- ES modules
- Async/await over callbacks
- Descriptive variable names
- Error handling with try/catch at service boundaries
- No `any` types — use proper generics and type narrowing

## React & client performance
- Hoist module-level constants (arrays, configs) outside component bodies. Fresh allocation on every render is wasted work.
- `useState(() => init)` for any non-trivial initial value so the computation runs once, not on every render.
- Prefer the adjust-state-during-render pattern over `useEffect` + `setState` for resetting derived state when a prop changes (avoids cascading renders).
- Derive state from existing state/props instead of syncing with `useEffect` when possible.
- Stable list keys (`item.id`, never the array index) for anything that can reorder or be filtered.
- CSS Modules for component styles; avoid inline `style` props except for one-off computed positioning.

## Pruning dead code
- If nothing imports an export, delete it. Same for type-union members never produced, options never passed, state fields returned but never read.
- Don't keep speculative abstractions "in case we need them later." When the need is real, the change is small. Until then, the helper just misleads the next reader about where the source of truth is.
- Inconsistent constants (e.g. `MAX_REPOS` set to different values in two files) are bugs in waiting. Unify on one source of truth, or split the concept into two named constants if they really are different.

## Git & Commit Rules
- **Separate commits for client and server** — never mix frontend and backend changes in one commit
- **Scope = code area**, not phase number or ticket. Use `client`, `server`, or a specific area like `chunker`, `llm`, `OverviewTab`
- **No Co-Authored-By lines** in commit messages
- Commit message format: `type(scope): short description`
  - Types: `feat`, `fix`, `refactor`, `style`, `chore`
  - Examples: `feat(client): add dark mode toggle`, `fix(server): cap zip extraction at 150MB`
- One concern per PR — don't bundle unrelated changes
- **Subject-line only for routine work.** Add a body only when a non-obvious trade-off or constraint drove the decision and isn't already captured in the diff, a code comment, or NOTES.md. Bodies should be one short paragraph, not a multi-paragraph story.
- Confirm before pushing; never force-push main
- **Pre-commit hook (husky):** every commit runs lint-staged (ESLint for client, tsc for server on staged files) then `vitest run --changed HEAD~1` for both client and server. Don't bypass with `--no-verify` unless you have a good reason.

## Documentation Rules
- **Major changes go in [`NOTES.md`](./NOTES.md) in the same PR.** Commit messages capture the *what*; NOTES.md captures the *why*: what the problem was, what was tried, what trade-offs were accepted, what would have happened otherwise.
- Triggers that always need a note:
  - Architectural decisions (data model, RAG pipeline shape, chunking strategy)
  - Performance tuning (memory limits, batch sizes, caching choices)
  - Deployment-driven constraints (platform RAM, rate limits, proxy quirks) — name the platform
  - Security or auth changes
  - Anything where future-you would ask "wait, why is this 16 and not 64?"
- When updating an existing decision, edit the existing section rather than appending a new one — keep one canonical entry per topic.
- Cross-link related entries inside NOTES.md so they're discoverable together.
