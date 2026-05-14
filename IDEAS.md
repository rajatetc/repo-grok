# Ideas & Future Work

## Contents
- [Conversational chat (multi-turn history)](#conversational-chat-multi-turn-history)
- [Tests](#tests)
- [Persistent storage](#persistent-storage)
- [User context / persona](#user-context--persona-for-better-answers)
- [Source citations in chat](#source-citations-in-chat)
- [UI progress during indexing](#ui-progress-during-indexing)
- [Auth + usage limits](#auth--usage-limits)
- [Multi-model support](#multi-model-support)
- [Embedding model worker threads](#embedding-model-worker-threads)
- [Cron-refresh pre-baked seeds](#cron-refresh-pre-baked-seeds-via-github-actions)
- [Private repo support](#private-repo-support)
- [More languages](#more-languages)
- [Vector database at scale](#vector-database-when-scale-demands-it)
- [Visualizations](#visualizations)
- [Serialize ingests per process](#serialize-ingests-per-process-defense-against-oom)

---

## Conversational Chat (multi-turn history)
Currently each question is stateless — Gemini gets the repo context + RAG chunks + the current
query, but has no memory of previous turns. A follow-up like "how does it handle errors?" has no
referent; Gemini can't know "it" means the function mentioned two messages ago.

**Fix:** send the last N message pairs along with each request.

- Client already holds the full message array in Zustand. Send the last 6–10 messages as a
  `history` field in the `POST /api/repos/:id/query` body.
- Server passes them to `model.startChat({ history })` instead of `generateContentStream`.
- Trim history to the last 4–6 turns to keep token usage bounded — older context is less useful
  than the freshly-retrieved RAG chunks anyway.

No server-side session state needed. Small payload increase per request; big quality improvement
for multi-turn conversations.

---

## Tests
Unit tests exist for `parseGitHubUrl`, `detectTechStack`, and `chunkFile` (34 tests total via Vitest).

**Still missing:**
- **Integration test:** a small fixture repo (10–20 JS files committed to `server/fixtures/`) that runs the full ingest → embed → search pipeline and asserts top result is relevant
- **LLM tests:** hard to unit test; would require mocking the Gemini SDK stream

---

## Persistent Storage
- Currently: in-memory — data lost on server restart (example repos survive via pre-baked seeds)
- Add: store embeddings + metadata in SQLite or Postgres (pgvector)
- Users can return to previously indexed repos without re-ingesting
- **Upgrade path:** pgvector is the simplest — same Postgres DB, just adds a vector index

---

## User Context / Persona for Better Answers
Let users optionally describe themselves before asking questions:
- e.g. "I'm a junior dev", "I'm a backend engineer, ignore frontend details", "explain like I'm new to React"
- Store context per session and inject it into every LLM prompt
- Also let users set a "focus area": architecture / security / performance / beginner-friendly

Small UX addition, meaningful improvement to answer quality.

---

## Source Citations in Chat
After each answer, show which files/chunks were used as context:
- Small "Sources" section under each assistant message
- List file paths as clickable chips: `src/middleware/auth.ts`, `src/routes/users.ts`
- Clicking a chip could highlight that file in the folder tree

The chunks are already returned from `search()` — just need to surface them in the response.

---

## UI Progress During Indexing
Current state: fake progress bar with hardcoded time checkpoints.

**Real progress via SSE:**
- New `POST /api/repos/stream` endpoint streams ingestion events
- Events: `{ stage: "fetch", done: 23, total: 150 }` etc.
- Client drives a real progress bar: `Fetching (23/150 files) → Chunking → Embedding (45/312) → Done`

---

## Auth + Usage Limits
- Login (Clerk or Auth0) so users have accounts
- Free tier: 3–5 ingestions/day for unauthenticated users; higher for logged-in
- Per-user API key storage instead of per-request header
- Usage dashboard: repos indexed, tokens used

---

## Multi-Model Support
- Swap embedding/LLM model per user preference: Cloudflare BGE (default), OpenAI, Cohere
- Abstraction lives in `embeddings.ts` + `llm.ts` — only those two files need changing
- **Blocker:** embedding dimensions differ per provider (Cloudflare BGE=384, OpenAI=1536),
  so vectors from different models can't be mixed in the same store

---

## Embedding Model Worker Threads
*Stale — embeddings are now a remote API call (Cloudflare Workers AI), so there's no in-process model to worry about. Keeping the entry for context: when we were using `@xenova/transformers` locally, the model singleton ran on the main thread, and two concurrent calls could race on internal tensor state. Not relevant under the current architecture.*

---

## Cron-refresh pre-baked seeds via GitHub Actions

**Current:** example repo seeds (`server/seeds/*.json`) are committed once and only refreshed when someone runs `npm run prebake` locally and commits the result. Over time the seeds drift — the live repo gets new functions, refactors, etc., but our embeddings are frozen.

**Why this is fine for now:** the three example repos (redux, express, axios) are mature and low-velocity. Their public APIs haven't meaningfully shifted in years. Embeddings stay ~90% accurate for 12+ months.

**When it would matter:** if we add fast-moving example repos (e.g. a Next.js demo, a current React app) or want the demo to always reflect *today's* code.

**Why cron-job.org pinging a refresh endpoint doesn't work:** Render's filesystem is ephemeral. Refreshed seeds would live in memory only and revert to the (stale) committed JSONs on every restart, sleep cycle, or deploy. Worst of both worlds.

**Real fix: GitHub Actions weekly cron.**
1. `.github/workflows/refresh-seeds.yml` runs `npm run prebake` on a schedule
2. `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` stored in GitHub Secrets
3. Auto-commit updated `server/seeds/*.json` back to `main`
4. Render auto-deploys on push → fresh seeds, persisted, no manual step

~30 lines of YAML, plus repo write permission for the workflow. Cost: negligible — Cloudflare free tier handles 10K neurons/day.

**See also:** [Pre-baked seeds](./NOTES.md#pre-baked-seeds-for-example-repos) for the static current implementation.

---

## Private Repo Support
- Currently: public GitHub repos only
- Add: zip file upload for private repos
- Add: GitHub OAuth so users can authorize access to their own private repos

---

## More Languages
- Currently: JS/TS only (Babel parser)
- Add: Python (tree-sitter), Go, Rust
- Swap parser per file extension; keep chunking pipeline the same

---

## Vector Database (when scale demands it)
- Currently: linear scan in memory (~10ms for <10k chunks per repo)
- At millions of vectors: Pinecone / Qdrant / Weaviate
- pgvector is the simplest upgrade path — same DB, adds a vector index

---

## Visualizations
Diagrams (Mermaid, React Flow) were prototyped and removed — LLM-generated graph syntax was too
unreliable for a good default experience.

Potential approaches that would be more reliable:
- **Import graph:** parse `import` statements from existing AST chunks, build a directed file dependency graph, render with React Flow (no LLM needed — deterministic)
- **Component tree:** detect parent → child JSX relationships from the chunk data
- **On-demand diagrams:** let the user ask for a diagram in chat rather than generating one automatically — moves the unreliability problem to an explicit user action

---

## Serialize ingests per process (defense against OOM)

**Incident:** 2026-05-14, ingesting `mui/material-ui` OOM-killed the Node process on Render. Production logs showed 3 fetches for the same repo within 4 seconds, then the process restarted with no error — the kernel had killed it for exceeding the 512MB container ceiling.

**Immediate trigger:** the client-side cancel-button form-resubmit bug (now fixed in `0c10b3b`) re-submitted the ingest form on every Cancel click, fanning out 3 parallel ingests of a massive monorepo. Each ingest's peak memory stacked and overflowed the box.

**The gap that remains:** even with the client bug gone, the server has **no guard against concurrent ingests on the same process**. Multiple tabs, retry storms, or future client bugs could trigger the same failure mode. The existing memory tuning (`EMBED_BATCH_SIZE=16`, `--max-old-space-size=400`, `MAX_TOTAL_CHUNKS=3000`, 150 MB / 500 KB byte caps, LRU=10) is all sized for **one ingest at a time**. Peak per-ingest is ~350 MB; two in parallel doesn't fit in 512 MB.

**Proposed fix when this is worth building:**
1. New `server/src/services/ingestQueue.ts` with a promise-chain lock (`withIngestLock`) so only one ingest runs at a time per process. Tracks queue position.
2. SSE `progress` event with `stage: "queued", position: N` so the client can show a "waiting in queue — N ahead of you" state instead of looking frozen.
3. 15s heartbeat (`res.write(":\n\n")`) while queued so Render's proxy doesn't idle-timeout the SSE connection during long waits.
4. `req.on("close")` short-circuit so a client that closed during the queue doesn't waste a slot running its ingest when its turn arrives.
5. Upfront `MAX_SOURCE_FILES = 1500` reject after `fetchRepo` — handles the pathological-large-repo case (`mui/material-ui` has ~5K source files; popular ingest targets like redux/axios/zod/immer are all under 500).

**Trigger to implement:** another OOM in production logs, or analytics showing concurrent ingest attempts becoming common (e.g. >5% of requests overlap an existing in-flight ingest).

**See also:** [Render free tier memory tuning](./NOTES.md#render-free-tier-memory-tuning) — explains the per-ingest peak and the existing knobs we used to fit one ingest in 512 MB.
