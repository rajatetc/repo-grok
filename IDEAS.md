# Ideas & Future Work

## Contents
- [Tests](#tests)
- [Persistent storage](#persistent-storage)
- [User context / persona](#user-context--persona-for-better-answers)
- [Source citations in chat](#source-citations-in-chat)
- [UI progress during indexing](#ui-progress-during-indexing)
- [Auth + usage limits](#auth--usage-limits)
- [Multi-model support](#multi-model-support)
- [Embedding model worker threads](#embedding-model-worker-threads)
- [Private repo support](#private-repo-support)
- [More languages](#more-languages)
- [Vector database at scale](#vector-database-when-scale-demands-it)
- [Visualizations](#visualizations)

---

## Tests
No tests currently. Best candidates:

- **`chunker.ts`** — pure function (files in → chunks out), easy to unit test; good coverage of the component/hook/class/type detection logic
- **`techDetector.ts`** — pure function; trivial to assert that React/Redux/Tailwind repos detect correctly
- **`parseGitHubUrl`** in `github.ts` — many edge cases (trailing slash, `.git` suffix, branch in URL, invalid chars); a natural unit test target
- **Integration:** a small fixture repo (10–20 JS files committed to `server/fixtures/`) that runs through the full ingest → embed → query pipeline and asserts the top result is relevant

Even 10–15 focused tests would meaningfully cover the most critical logic paths.

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
- Swap embedding/LLM model per user preference: local MiniLM (default), OpenAI, Gemini API
- Abstraction lives in `embeddings.ts` + `llm.ts` — only those two files need changing
- **Blocker:** embedding dimensions differ per provider (local=384, Gemini=768, OpenAI=1536),
  so vectors from different models can't be mixed in the same store

---

## Embedding Model Worker Threads
The model singleton runs on the main thread. Two concurrent calls (e.g. query + ingest) can race
on internal tensor state.

**Short-term:** single-slot async queue — safe, zero complexity.

**Proper fix:** run `@xenova/transformers` in `worker_threads`. Spawn N workers (CPU cores - 1),
each with its own model instance. Main thread sends batches via `postMessage`. ~100 lines for the
pool + messaging protocol.

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
