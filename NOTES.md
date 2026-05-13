# Architectural Decisions

## Why in-memory vector store instead of a vector DB
Linear cosine similarity scan over all chunks takes ~10ms in memory for repos with <10k chunks.
A real vector DB (Pinecone, Qdrant) adds network latency, API cost, and operational complexity
for no measurable gain at this scale. The entire store lives in a `Map<repoId, CodeChunk[]>`.
Upgrade path: pgvector when persistent storage is added.

## Why Gemini for everything (embeddings + LLM)
Free tier covers both text-embedding-004 (1500 req/day) and Gemini 2.0 Flash (1500 req/day).
No credit card required. All Gemini calls are isolated to two files: `embeddings.ts` and `llm.ts`
(Phase 7) — swapping to OpenAI/Anthropic means changing only those two files.

## Why no model abstraction layer yet
Embedding dimensions differ across providers (Gemini=768, OpenAI=1536). Building a proper adapter
means normalizing dimensions, streaming formats, rate limits, and error codes. Not worth it until
there's a second provider to support. See IDEAS.md → Multi-Model Support.

## Why embeddings include file path + chunk type, not just raw code
Prepending `File: src/hooks/useAuth.ts\nType: hook\nName: useAuth` before the code body makes the
vector carry semantic context. A query like "authentication logic" can match the chunk even if the
word "auth" doesn't appear in the function body.

## Why tech stack detection uses Gemini instead of a hardcoded map
A hardcoded map needs constant maintenance as new frameworks emerge. Gemini reads package.json
and config file names and returns structured JSON — zero maintenance, handles any framework.
Runs once per ingestion on a tiny payload (~1-2KB), so cost is negligible.

## Why test files are included in ingestion
Test files reveal how functions are meant to be called and what edge cases the author considered.
Excluding them makes RAG answers worse for questions like "how is X used?" or "what are the edge
cases for Y?". Only generated/third-party code (node_modules, dist, build) is excluded.

## Why file size limit is 500KB not 50KB
Files >50KB can still be legitimate source files (large utility files, complex components).
The chunker splits them anyway, so size doesn't affect LLM token usage. Only truly
generated/minified files (which are usually much larger or have `.min.` in the name) are skipped.

## API key security (planned for Phase 8)
Sending an API key over HTTPS is the industry standard (OpenAI Playground, Vercel dashboard, etc.).
JWT doesn't add security here — it's for identity, not secret protection.
Planned approach: user sends key once to POST /session, gets back a sessionId, all subsequent
requests use only the sessionId. Key never travels over the wire again.

## Why IP-based rate limiting instead of login for MVP
Login requires an auth service (Clerk/Auth0), a database, and session management — 2-3 days of
work orthogonal to the core product. IP-based rate limiting (express-rate-limit) takes 10 minutes
and prevents casual abuse. Login + quotas belongs in a v2. See IDEAS.md → Auth + Usage Limits.

## Deployment strategy
Backend (Express, stateful) → Railway: persistent process, auto-deploys from GitHub, env vars in dashboard.
Frontend (React/Vite, static) → Vercel: free static hosting, also deploys from GitHub.
API keys (GEMINI_API_KEY, GITHUB_TOKEN) go in Railway's dashboard — never in GitHub repo or GitHub Secrets.
Frontend gets VITE_API_URL pointing to the Railway backend URL.
Caveat: Railway free tier sleeps after inactivity — in-memory store is lost on wake. Acceptable for MVP.
Upgrade path: add SQLite/pgvector persistence (IDEAS.md) to survive restarts.

## Chunking strategy: top-level AST nodes only
We only chunk top-level declarations (functions, classes, types at the module root). Chunking every
nested helper would create thousands of tiny low-value chunks and flood the vector store with noise.
A 300-line component is split into parts (MyComponent_part0, etc.) at blank lines or closing braces.
Fallback to line-based splitting if Babel can't parse the file.
