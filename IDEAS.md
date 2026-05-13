# Ideas & Future Work

## User Context / Persona for Better Answers
- Let users optionally describe themselves before asking questions
  e.g. "I'm a junior dev", "I'm a backend engineer, ignore frontend details", "explain like I'm new to React"
- Store context per session and inject it into every LLM prompt
- Could also let users set a "focus area": architecture / security / performance / beginner-friendly
- Small UX addition, meaningful improvement to answer quality

## Auth + Usage Limits
- Add login flow (Clerk or Auth0) so users have accounts
- Free tier: 3-5 repo ingestions per day for unauthenticated users
- Logged-in users get higher limits
- Per-user API key storage (instead of IP-based sessions)
- Usage dashboard showing how many repos indexed, tokens used

## User-Supplied API Keys
- Let users bring their own Gemini/OpenAI key
- Session-based: user sends key once → server returns sessionId → key stays server-side
- Store encrypted in memory, never log it
- Unlocks: users aren't rate-limited by our quota

## Multi-Model Support
- Swap embedding/LLM model per user preference
- Gemini (default, free), OpenAI, Anthropic
- Abstraction lives in embeddings.ts + llm.ts — only those two files need changing

## UI Progress During Indexing
- Stream ingestion progress via SSE (Server-Sent Events)
- Show live steps: Fetching → Chunking → Embedding (45/312) → Done
- Estimate time remaining based on chunk count

## Private Repo Support
- Currently: public GitHub repos only
- Add: zip file upload for private repos
- Add: GitHub OAuth so users can authorize access to their private repos

## More Languages
- Currently: JS/TS only (Babel parser)
- Add: Python (tree-sitter), Go, Rust
- Swap parser per file extension, keep chunking pipeline the same

## Persistent Storage
- Currently: in-memory (data lost on server restart)
- Add: store embeddings + metadata in SQLite or Postgres (pgvector)
- Users can return to previously indexed repos without re-ingesting

## Vector Database (when scale demands it)
- Currently: linear cosine similarity scan in memory (~10ms for <10k chunks)
- At millions of vectors across thousands of users, switch to Pinecone / Qdrant / Weaviate
- pgvector (Postgres extension) is the simplest upgrade path — same DB, just adds an index
- Not needed until you have many concurrent users storing many repos
