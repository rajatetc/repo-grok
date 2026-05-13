# Architectural Decisions

## Contents
- [In-memory vector store](#why-in-memory-vector-store-instead-of-a-vector-db)
- [Gemini for everything](#why-gemini-for-everything-embeddings--llm)
- [No model abstraction layer yet](#why-no-model-abstraction-layer-yet)
- [Embedding context enrichment](#why-embeddings-include-file-path--chunk-type-not-just-raw-code)
- [Tech stack detection via LLM](#why-tech-stack-detection-uses-gemini-instead-of-a-hardcoded-map)
- [Test files included](#why-test-files-are-included-in-ingestion)
- [500KB file size limit](#why-file-size-limit-is-500kb-not-50kb)
- [API key strategy for Phase 9](#api-key-strategy-hybrid-pre-warm--user-supplied)
- [Frontend UX decisions for Phase 9](#frontend-ux-decisions-phase-9)
- [API key security](#api-key-security)
- [IP-based rate limiting](#why-ip-based-rate-limiting-instead-of-login-for-mvp)
- [Deployment strategy](#deployment-strategy)
- [Chunking strategy](#chunking-strategy-top-level-ast-nodes-only)

---

## Why in-memory vector store instead of a vector DB
Linear cosine similarity scan over all chunks takes ~10ms in memory for repos with <10k chunks.
A real vector DB (Pinecone, Qdrant) adds network latency, API cost, and operational complexity
for no measurable gain at this scale. The entire store lives in a `Map<repoId, CodeChunk[]>`.

**Upgrade path:** pgvector when persistent storage is added.

---

## Why Gemini for everything (embeddings + LLM)
Free tier covers both `gemini-embedding-001` and Gemini 2.5 Flash with no credit card required.
All Gemini calls are isolated to two files: `embeddings.ts` and `llm.ts` —
swapping to OpenAI/Anthropic means changing only those two files.

**Current model choices (as of May 2026):**
- **Embeddings:** `gemini-embedding-001` (768-dim, 2048 token input limit). Replaces `text-embedding-004`
  which was removed from the API. Does not support `batchEmbedContents` — we use 5 parallel
  `embedContent` calls per batch with a 3.5s delay, targeting ~80 RPM (free tier cap is 100 RPM).
  Each chunk = 1 API call, so a 150-chunk repo takes ~2 min, a 500-chunk repo ~10 min.
- **LLM:** `gemini-2.5-flash`. `gemini-2.0-flash` has `limit: 0` on AI Studio free tier keys.

---

## Why no model abstraction layer yet
Embedding dimensions differ across providers (Gemini=768, OpenAI=1536). Building a proper adapter
means normalizing dimensions, streaming formats, rate limits, and error codes. Not worth it until
there's a second provider to support.

**See also:** IDEAS.md → Multi-Model Support.

---

## Why embeddings include file path + chunk type, not just raw code
Prepending `File: src/hooks/useAuth.ts\nType: hook\nName: useAuth` before the code body makes the
vector carry semantic context. A query like "authentication logic" can match the chunk even if the
word "auth" doesn't appear in the function body.

---

## Why tech stack detection uses Gemini instead of a hardcoded map
A hardcoded map needs constant maintenance as new frameworks emerge. Gemini reads package.json
and config file names and returns structured JSON — zero maintenance, handles any framework.
Runs once per ingestion on a tiny payload (~1-2KB), so cost is negligible.

**Known limitation:** The file fetcher only pulls `.js/.ts` files, so `package.json` is never
fetched. Tech detection relies on the LLM inferring stack from import statements and config
filenames alone. For repos where no package.json content is available, `techStack` returns `{}`.
Fix: fetch `package.json` explicitly during ingestion (not yet implemented).

---

## Why test files are included in ingestion
Test files reveal how functions are meant to be called and what edge cases the author considered.
Excluding them makes RAG answers worse for questions like "how is X used?" or "what are the edge
cases for Y?". Only generated/third-party code (`node_modules`, `dist`, `build`) is excluded.

---

## Why file size limit is 500KB not 50KB
Files >50KB can still be legitimate source files (large utility files, complex components).
The chunker splits them anyway, so size doesn't affect LLM token usage. Only truly
generated/minified files (which are usually much larger or have `.min.` in the name) are skipped.

---

## API key security
Sending an API key over HTTPS is the industry standard (OpenAI Playground, Vercel dashboard, etc.).
JWT doesn't add security here — it's for identity, not secret protection.

**Planned approach:** user sends key once to `POST /session`, gets back a `sessionId`, all subsequent
requests use only the `sessionId`. Key never travels over the wire again.

---

## Why IP-based rate limiting instead of login for MVP
Login requires an auth service (Clerk/Auth0), a database, and session management — 2-3 days of
work orthogonal to the core product. IP-based rate limiting (`express-rate-limit`) takes 10 minutes
and prevents casual abuse. Login + quotas belongs in a v2.

**See also:** IDEAS.md → Auth + Usage Limits.

---

## Deployment strategy
- **Backend** (Express, stateful) → Railway: persistent process, auto-deploys from GitHub, env vars in dashboard.
- **Frontend** (React/Vite, static) → Vercel: free static hosting, also deploys from GitHub.
- API keys (`GEMINI_API_KEY`, `GITHUB_TOKEN`) go in Railway's dashboard — never in GitHub repo or GitHub Secrets.
- Frontend gets `VITE_API_URL` pointing to the Railway backend URL.

**Caveat:** Railway free tier sleeps after inactivity — in-memory store is lost on wake. Acceptable for MVP.
**Upgrade path:** add SQLite/pgvector persistence (IDEAS.md) to survive restarts.

---

## Chunking strategy: top-level AST nodes only
We only chunk top-level declarations (functions, classes, types at the module root). Chunking every
nested helper would create thousands of tiny low-value chunks and flood the vector store with noise.
A 300-line component is split into parts (`MyComponent_part0`, etc.) at blank lines or closing braces.
Fallback to line-based splitting if Babel can't parse the file.

---

## API key strategy: hybrid pre-warm + user-supplied

The free-tier limits (100 RPM, 1000 req/day) make a shared server-side key unworkable as soon
as 2–3 users submit repos concurrently. The solution is a two-tier approach:

**Tier 1 — Pre-warmed example repos (no key needed):**
- At server startup, ingest the 6 curated example repos if not already in the store
- These are available instantly to all visitors, zero quota used per request
- Covers the demo/exploration use case completely
- Examples: immer, redux, zustand, swr, axios, zod

**Tier 2 — User-supplied key for custom repos:**
- User pastes their own free Gemini AI Studio key to index any other repo
- Key is sent once to `POST /session`, stored encrypted in memory, never re-transmitted
- Their quota, their limits — we're not responsible for their usage
- Framing: "Get a free key at aistudio.google.com — takes 30 seconds, no card needed"

**Why this works:**
- Demo experience is instant and zero-friction (tier 1)
- Power users who want their own repos can self-serve (tier 2)
- We never run out of quota on the server key

---

## Frontend UX decisions (Phase 9)

**Landing page:**
- Hero: short tagline + GitHub URL input box
- Below input: 6 clickable example repo cards (name, one-line description, est. time)
- Clicking a card fills the URL input — user still hits "Explore" so they feel in control
- No API key field on landing — only shown when they try a non-example repo

**Ingestion flow:**
- Show a live progress stepper: `Fetching files → Chunking → Embedding (12/150) → Ready`
- Before ingestion starts, use the file count from the GitHub tree response to show
  "~2 min" estimate upfront — no surprises
- Progress streamed via SSE (requires a new `POST /api/repos/:id/progress` SSE endpoint,
  or fold it into the existing ingest route)

**Repo overview page (after ingestion):**
- Tech stack badges (Express, TypeScript, etc.)
- Folder tree explorer (collapsible)
- Architecture summary paragraph (LLM-generated, runs once on ingest)
- Tab bar: Overview / Chat / Change Guide

**Chat tab:**
- Simple message thread — user types, streamed answer appears word by word
- Show which files were used as context (source citations under each answer)
- Suggested starter questions based on the repo (LLM-generated on ingest)

**Change Guide tab:**
- Text area: "Describe the change you want to make"
- Output: a card per file — file path, why it needs changing, what to do
