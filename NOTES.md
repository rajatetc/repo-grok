# Architectural Decisions

## Contents
- [In-memory vector store](#why-in-memory-vector-store-instead-of-a-vector-db)
- [Local embeddings instead of Gemini](#why-local-embeddings-instead-of-gemini-api)
- [No model abstraction layer yet](#why-no-model-abstraction-layer-yet)
- [Embedding context enrichment](#why-embeddings-include-file-path--chunk-type-not-just-raw-code)
- [Tech stack detection](#why-tech-stack-detection-is-deterministic-not-llm-based)
- [Test files included](#why-test-files-are-included-in-ingestion)
- [File size limit](#why-file-size-limit-is-500kb)
- [Zip download over per-file API](#why-zip-download-instead-of-per-file-octokit-calls)
- [API key handling](#api-key-handling)
- [IP-based rate limiting](#why-ip-based-rate-limiting-instead-of-login-for-mvp)
- [Deployment strategy](#deployment-strategy)
- [Chunking strategy](#chunking-strategy-top-level-ast-nodes-only)
- [Frontend UX decisions](#frontend-ux-decisions)

---

## Why in-memory vector store instead of a vector DB
Linear cosine similarity scan over all chunks takes ~10ms in memory for repos with <10k chunks.
A real vector DB (Pinecone, Qdrant) adds network latency, API cost, and operational complexity
for no measurable gain at this scale. The entire store lives in a `Map<repoId, CodeChunk[]>`.

**Pros:**
- Zero latency (no network hop)
- Zero cost and zero external dependencies
- Dead simple to reason about — a plain JS array per repo
- Fast enough: 10k chunks scanned in ~10ms

**Cons:**
- Lost on server restart (pre-baked seeds mitigate this for examples; user-indexed repos are gone)
- No persistence across deploys
- Doesn't scale past ~100k chunks without noticeable slowdown
- All repos share process memory — a pathologically large repo could OOM

**Upgrade path:** pgvector when persistent storage is added.

---

## Why local embeddings instead of Gemini API
Originally used `gemini-embedding-001` (768-dim, 100 RPM / 1000 req/day free tier).
A 150-chunk repo took ~2 min; a 500-chunk repo ~10 min — and re-indexing the same examples
on every restart burned through the daily quota within minutes.

Switched to `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` locally:
- **23MB one-time download**, cached on disk after first run
- **384-dimensional** vectors, cosine similarity works the same way
- **Zero API calls** for indexing — no quota, no rate limits, no billing
- **No GEMINI_API_KEY required** to run the server or pre-bake seeds
- Model loads once into the process on startup (promise-cached singleton), shared by all requests

Gemini is still used for one thing only: the LLM (`gemini-2.5-flash`) that reads retrieved chunks
and answers questions. That's a much lower call volume (one per user question, not one per chunk).

**Trade-off:** local inference is CPU-bound. On a cold server the first embedding takes ~1–2s
while the model warms up. Subsequent chunks are fast (~5–20ms each).

---

## Why no model abstraction layer yet
Embedding dimensions differ across providers (local MiniLM=384, Gemini=768, OpenAI=1536).
Building a proper adapter means normalizing dimensions, streaming formats, rate limits, and
error codes. Not worth it until there's a second provider to support.

**See also:** IDEAS.md → Multi-Model Support.

---

## Why embeddings include file path + chunk type, not just raw code
Prepending `File: src/hooks/useAuth.ts\nType: hook\nName: useAuth` before the code body makes the
vector carry semantic context. A query like "authentication logic" can match the chunk even if the
word "auth" doesn't appear in the function body.

---

## Why tech stack detection is deterministic, not LLM-based
`package.json` is fetched as part of the zip download, so we have the full dep list.
A lookup table of ~80 known packages covers 90%+ of real-world JS/TS repos instantly,
with zero API cost, zero latency, and zero failure modes.

Config file names (e.g. `tailwind.config.*`, `vite.config.*`, `schema.prisma`) add a second
signal layer for tools that are sometimes in devDeps or not in package.json at all.

**Known limitation:** niche, private, or very new packages won't be detected. Detection is
best-effort and informational — it does not affect RAG quality.

**Previous approach:** used Gemini for detection. Removed because it added ~500ms latency,
failed silently when the API key was missing, and an LLM has no real advantage over a lookup
table for structured JSON input.

---

## Why test files are included in ingestion
Test files reveal how functions are meant to be called and what edge cases the author considered.
Excluding them makes RAG answers worse for questions like "how is X used?" or "what are the edge
cases for Y?". Only generated/third-party code (`node_modules`, `dist`, `build`) is excluded.

---

## Why file size limit is 500KB
Files >500KB are typically generated, minified, or lock files — not human-written source.
The chunker still splits large legitimate files at logical boundaries (blank lines, closing braces),
so a large component is handled fine.

---

## Why zip download instead of per-file Octokit calls
A single `GET /repos/:owner/:repo/zipball/:branch` fetches the entire repo in one HTTP round-trip.
The alternative — Octokit's Git Trees API + individual file content calls — requires N+1 requests
(one for the tree, one per file), hitting GitHub's rate limit quickly on large repos.

The zip is loaded into memory, extracted with `adm-zip`, filtered to allowed extensions, and each
file decoded to UTF-8. Total uncompressed bytes are capped at 150 MB to prevent zip bomb attacks.

---

## API key handling
`GEMINI_API_KEY` lives in the server's environment — clients never see it. Used only for LLM
calls (question answering), not for indexing.

Users can optionally supply their own Gemini key via the UI (stored in Zustand memory only —
never written to disk or localStorage). It travels as an `x-gemini-key` request header and
takes precedence over the server key. Gone when the browser tab closes.

---

## Why IP-based rate limiting instead of login for MVP
Login requires an auth service, a database, and session management — days of work orthogonal to
the core product. IP-based rate limiting (`express-rate-limit`) takes minutes and prevents casual
abuse.

Two limiters:
- General: 100 req / 15 min (all routes)
- Ingest: 5 req / hour (POST /api/repos — fetching + embedding is CPU-intensive)

**See also:** IDEAS.md → Auth + Usage Limits.

---

## Deployment strategy
- **Backend** (Express, stateful) → Railway: persistent process, auto-deploys from GitHub, env vars in dashboard.
- **Frontend** (React/Vite, static) → Vercel: free static hosting, deploys from GitHub.
- `GEMINI_API_KEY` and `GITHUB_TOKEN` go in Railway's dashboard — never in the repo.
- Frontend `VITE_API_URL` points to the Railway backend URL.

**Caveat:** Railway free tier sleeps after inactivity — in-memory store is lost on wake.
Pre-baked seeds survive restarts for the example repos.

---

## Chunking strategy: top-level AST nodes only
We only chunk top-level declarations (functions, classes, types at the module root). Chunking every
nested helper would create thousands of tiny low-value chunks and flood the vector store with noise.
A 300-line component is split into parts at blank lines or closing braces.
Fallback to line-based splitting if Babel can't parse the file.

---

## Frontend UX decisions

**Layout:**
- Two-column: fixed 280px sidebar (left) + full-height chat area (right)
- Sidebar has Overview / Pulse tabs — sticky tab strip, content scrolls independently

**Overview tab:**
- Stats grid: file count, branch, lines of code, dependencies, dev dependencies
- Code unit pills: component / hook / function / class counts from chunker output
- Tech stack badges grouped by category (Framework, Build, State, Testing, Styling, Backend)
- Collapsible folder tree — top-level dirs open by default, file names link to GitHub

**Pulse tab:**
- Live GitHub data fetched client-side (no server proxy) on first tab open, cached for the session
- Stars, forks, last push date
- Open issues (top 5, with labels, linking to GitHub issues page)
- Open PRs (top 5, linking to GitHub pulls page)
- Top 5 contributors with avatars

**Ingestion flow:**
- POST /api/repos is now SSE — streams `fetch → chunk → embed X/N → done` events
- Client drives a real progress bar from these events; pipeline steps (Fetch → Parse → Embed → Chat) light up live
- Chunks sorted by semantic priority (components first, imports last) before the 3000-chunk cap
- Stale repo URL navigated to directly redirects home immediately (no stuck loading screen)

**Chat:**
- User messages: right-aligned pill bubble
- Assistant messages: left-aligned, markdown rendered (GFM)
- Streaming via SSE — cursor blinks while response arrives
- Multi-turn: last 10 messages sent as history on each query so follow-up questions have context
- Rate limit nudge: banner appears only on Gemini quota errors, prompts to add own key

**Dark mode:**
- Follows system `prefers-color-scheme` by default
- Manual toggle (☾ / ☀) in the nav on RepoPage, top-right corner on LandingPage
- Preference persisted in `localStorage` under key `"theme"`
- Implemented via `data-theme="dark"` on `<html>` and CSS custom properties — zero JS overhead per render

**Footer:**
- Always visible on both pages: Built by · GitHub · LinkedIn · X
