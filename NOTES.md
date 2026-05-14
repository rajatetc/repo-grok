# Architectural Decisions

## Contents
- [In-memory vector store](#why-in-memory-vector-store-instead-of-a-vector-db)
- [Embedding model evolution](#embedding-model-evolution-gemini--local-xenova--cloudflare-workers-ai)
- [No model abstraction layer yet](#why-no-model-abstraction-layer-yet)
- [Embedding context enrichment](#why-embeddings-include-file-path--chunk-type-not-just-raw-code)
- [Tech stack detection](#why-tech-stack-detection-is-deterministic-not-llm-based)
- [Test files included](#why-test-files-are-included-in-ingestion)
- [File size limit](#why-file-size-limit-is-500kb)
- [Zip download over per-file API](#why-zip-download-instead-of-per-file-octokit-calls)
- [API key handling](#api-key-handling)
- [IP-based rate limiting](#why-ip-based-rate-limiting-instead-of-login-for-mvp)
- [Deployment strategy](#deployment-strategy)
- [Render 512MB tuning](#fitting-inside-renders-512mb-free-tier)
- [Trust proxy on Render](#why-app-set-trust-proxy-1-on-render)
- [Keepalive ping](#cron-joborg-keepalive-instead-of-paying-to-stay-warm)
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

## Embedding model evolution: Gemini → Local Xenova → Cloudflare Workers AI

| Phase | Provider | Dims | Pros | Cons | Status |
|-------|----------|------|------|------|--------|
| 1 | Gemini `embedding-001` | 768 | Managed API | 100 RPM / 1K req/day free tier; 150-chunk repo took ~2 min; daily quota burned in minutes on restarts | Removed |
| 2 | Local `Xenova/all-MiniLM-L6-v2` | 384 | Zero API calls, zero cost | ~250MB RAM (ONNX), required aggressive tuning (`BATCH=16`, `--max-old-space=400`, `MAX_REPOS=5`), ~30s cold start | Removed |
| 3 | Cloudflare Workers AI `bge-small-en-v1.5` | 384 | 10K neurons/day free, 3000 RPM, 100 texts/batch, zero local RAM | External API dependency (network latency) | **Current** |

### Why Phase 3 won
- Same 384-dim as Phase 2 — vector store unchanged, no re-indexing needed
- ~250MB freed from ONNX → `MAX_REPOS` raised to 20, no `NODE_OPTIONS` tuning needed
- Cold start is now ~10–15s (just Express + seed loading, no model init)
- Retry with exponential backoff on 429s built into `callCloudflare()`

**Trade-off:** indexing now depends on an external API (network latency + availability).
The Cloudflare free tier is generous enough that rate limits haven't been an issue in practice.

**Impact on deployment:** with ~250MB freed from ONNX, `MAX_REPOS` can be raised (now 20),
and `NODE_OPTIONS` / batch size tuning from Phase 2 is no longer needed.

---

## Why no model abstraction layer yet
Embedding dimensions differ across providers (Cloudflare BGE=384, OpenAI=1536).
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

A single server key is shared across all users. Gemini 2.5 Flash's free tier (250 RPD) is
comfortable headroom for a personal-project traffic volume, and skipping a per-user "bring
your own key" flow removes a modal, a Zustand field, a rate-limit nudge banner, and an
`x-gemini-key` request header from the surface area. If the shared quota ever becomes a real
bottleneck (visible in server logs as 429s), reintroduce a user-supplied key path then —
not before.

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
- **Backend** (Express, stateful) → Render Web Service free tier: 512MB RAM, 0.1 CPU, sleeps after 15min idle.
- **Frontend** (React/Vite, static) → Vercel free tier: edge CDN.
- `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `GITHUB_TOKEN`, `CLIENT_URL` go in Render's dashboard. Frontend's `VITE_API_URL` goes in Vercel's.
- `NODE_ENV` is set in the **Start Command** (`NODE_ENV=production npm start`), not as a Render env var. Setting it as an env var would apply during `npm install` too and skip `devDependencies` — which the TypeScript build step needs (tsc, @types/*, etc).

**Why Render over Railway/Fly:**
- Railway killed their free tier in Aug 2023, now requires a card.
- Fly.io free tier caps at 256MB, which OOMs during embedding inference.
- Koyeb requires a card now (changed mid-2025).
- Render is the last major PaaS with a no-card free tier large enough for this app.

**See also:** [Render 512MB tuning](#fitting-inside-renders-512mb-free-tier) for the memory-fitting work, [keepalive ping](#cron-joborg-keepalive-instead-of-paying-to-stay-warm) for the sleep workaround.

---

## Fitting inside Render's 512MB free tier

The 512MB cap is shared between **two memory pools** that V8 tracks separately:

| Pool | What lives there | Manager |
|------|------------------|---------|
| **V8 heap** | JS objects, arrays, strings — `chunks[]`, `RepoFile[]`, LRU caches | V8 garbage collector |
| **Native (off-heap)** | ONNX model weights, inference tensor allocations, zlib buffers from `adm-zip` | C++ allocator inside each lib |

The container limits the **sum** of both, but V8 only controls its own pool. Without intervention, V8 thinks it has 1.7GB to play with (the default `--max-old-space-size`) and GCs lazily — so the heap drifts up while native memory is also growing, and the kernel kills the process at 512MB before V8 has any reason to GC aggressively.

**Symptom:** OOM during embedding inference, with peaks of ~430–500MB even with an empty cache.

**Two-part fix:**

1. **`EMBED_BATCH_SIZE = 16`** in `server/src/services/embeddings.ts` (was 64). ONNX inference allocates tensors of shape `[batch_size, tokens, hidden_size]` plus internal activations through 6 transformer layers. At batch=64 the inference peak was ~150–200MB native. At batch=16 it's ~40–50MB. Trade-off: 4× more batches per ingest, but the 0.1 CPU free tier is CPU-bound, not batch-throughput-bound, so wall-clock impact is ~10–20%.

2. **`NODE_OPTIONS=--max-old-space-size=400`** as a Render env var. Caps V8 heap at 400MB, leaving 112MB for native (model ~100MB, inference tensors, zlib). The more important effect is **GC timing** — V8 runs aggressive mark-and-sweep when the heap approaches its limit. A tight ceiling forces aggressive mode earlier, before native memory growth pushes the total past 512MB.

3. **Two-tier cache layout** (split out of a single LRU). Pre-baked example seeds live in a permanent `Map` (3 entries today: redux, express, axios) — they're loaded once at boot and never evicted, so landing-page example chips are always "instant click." User-ingested repos live in a bounded LRU at `USER_MAX_REPOS = 10`, which caps memory at a predictable ceiling (~60MB at ~6MB/repo for 3000 chunks × 384-float embeddings + content strings). The previous single LRU of 50 conflated the two: a burst of user ingests would silently evict the seeds, defeating the "instant" promise and forcing a re-embed on next click. The split costs one extra map lookup per `getMetadata` / `search` / `hasRepo` call — negligible.

**Result:** baseline ~220MB (3 seeds preloaded), peak ~350MB during a user ingest. Comfortable headroom on 512MB.

**See also:** [in-memory vector store](#why-in-memory-vector-store-instead-of-a-vector-db) explains why we have the LRU cache at all.

---

## Why `app.set("trust proxy", 1)` on Render

Render's free tier terminates TLS at a reverse proxy and forwards requests to the container over plain HTTP, with the real client IP in the `X-Forwarded-For` header. Express's default is `trust proxy = false`, which means `req.ip` is the proxy's IP (same for every request), and any middleware that looks at `X-Forwarded-For` gets suspicious.

Specifically, `express-rate-limit` v7 throws `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` because it doesn't know whether to trust the header — if trust is off but the header is present, the limiter would key on the proxy's IP and rate-limit everyone as one user.

`app.set("trust proxy", 1)` tells Express: "trust exactly one hop of `X-Forwarded-For`." That's correct for Render (one proxy between client and container). Don't use `true` blindly — that trusts arbitrary hops and lets clients spoof their IP by setting their own `X-Forwarded-For`.

---

## cron-job.org keepalive instead of paying to stay warm

Render free tier sleeps the service after 15 minutes of zero HTTP traffic. Waking it takes ~10–15s (Express startup + seed loading) — shows the first visitor a spinning page.

**Options considered:**
- Pay $7/mo for Render Starter (always-on). Defeats the "free tier" goal.
- Self-ping from inside the server (setInterval). Wouldn't work because the process is asleep — you can't wake yourself.
- External cron pinging `/health`. Render's community FAQ explicitly tolerates this for free-tier services.

**Chosen:** cron-job.org free account, schedule `*/14 * * * *` (every 14 minutes — slightly under the 15min sleep threshold to allow for clock drift), URL `https://repo-grok.onrender.com/health`.

**Budget check:** Render free is 750 hr/mo. Continuous uptime is 720 hr/mo, so one always-warm service stays under the cap. Adding a second free service on the same account would exceed it.

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

**Dark mode:**
- Follows system `prefers-color-scheme` by default
- Manual toggle (☾ / ☀) in the nav on RepoPage, top-right corner on LandingPage
- Preference persisted in `localStorage` under key `"theme"`
- Implemented via `data-theme="dark"` on `<html>` and CSS custom properties — zero JS overhead per render

**Footer:**
- Always visible on both pages: Built by · GitHub · LinkedIn · X
