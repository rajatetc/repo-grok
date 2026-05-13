# RepoGrok — AI-Powered Codebase Explainer

## What is this?
A web app that helps developers understand unfamiliar codebases. User pastes a GitHub URL (or uploads files), and the app generates an interactive overview, architecture diagrams, and answers questions about the code using RAG (Retrieval-Augmented Generation). Think of it as an AI onboarding assistant for any codebase.

## Core User Flow
1. User pastes a public GitHub repo URL (or uploads a zip for private repos)
2. App fetches all JS/TS files via GitHub API (Octokit)
3. Files are parsed into an AST using Babel, then chunked by semantic boundaries (functions, classes, components, hooks, types)
4. Chunks are converted to vector embeddings using Gemini's free embedding API
5. Embeddings stored in-memory with cosine similarity search (no external vector DB)
6. App generates an overview: tech stack detection, folder structure, architecture summary
7. User can ask questions ("how does auth work?") → RAG retrieves relevant chunks → sends only those chunks to Gemini LLM → streams response
8. User can describe a change ("I need to add a new API endpoint") → app shows which files to modify and suggests an approach
9. Visualizations: dependency graphs, component trees, architecture diagrams

## Tech Stack
- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript
- **AST Parser:** Babel (@babel/parser, @babel/traverse) for smart code chunking
- **Embeddings:** Gemini embedding API (free tier)
- **LLM:** Gemini 2.0 Flash (free tier)
- **Vector Search:** In-memory cosine similarity (no external DB)
- **GitHub API:** Octokit
- **Diagrams:** React Flow (interactive node graphs) + Mermaid.js (LLM-generated diagrams)

## Architecture Pipeline

```
Repo URL → GitHub API (fetch files) → Babel AST Parser (chunk by fn/class/component)
→ Gemini Embedding API (vectorize chunks) → In-memory Vector Store
→ User Query → Embed query → Cosine similarity (find top-k chunks)
→ Send relevant chunks + query to Gemini LLM → Stream response to UI
```

## Key Design Decisions

### Token Optimization
- Process repo ONCE during ingestion (parse → chunk → embed → store)
- Per query, only retrieve and send 5-10 relevant chunks to the LLM, NOT the whole codebase
- This is the RAG pattern

### Smart Chunking via AST
- Use Babel to parse JS/TS files into AST
- Chunk by semantic units: functions, React components, custom hooks, classes, type definitions, imports
- Max chunk size ~4000 chars (~1000 tokens)
- Large chunks split at logical boundaries (empty lines, closing braces)
- Fallback to line-based splitting if AST parsing fails
- Detect chunk types: component (PascalCase fns), hook (use* fns), function, class, type/interface, import, export

### Scope for MVP
- JS/TS repos only (React/frontend repos as primary target)
- Public GitHub repos only (file upload for private repos later)
- More languages can be added later by swapping/adding parsers

### Tech Stack Detection
- Parse package.json to auto-detect frameworks, state management, styling, testing, build tools, backend libs
- Also detect from file patterns (e.g. next.config = Next.js, tailwind.config = Tailwind)

### GitHub Repo Fetching
- Use Octokit's Git Trees API with recursive mode (single API call for full tree)
- Filter to only .js, .jsx, .ts, .tsx files
- Ignore: node_modules, dist, build, .next, coverage, __tests__, lock files
- Skip files > 50KB (likely generated/minified)
- Batch file content fetches (10 at a time) to avoid rate limits
- Build a folder tree structure from the flat file list for visualization

## Project Structure
```
repo-grok/
├── server/
│   ├── src/
│   │   ├── services/
│   │   │   ├── github.ts       # Repo fetcher (Octokit, file tree, URL parsing)
│   │   │   ├── chunker.ts      # AST chunker (Babel, semantic splitting)
│   │   │   ├── embeddings.ts   # Gemini embedding API integration
│   │   │   └── vectorStore.ts  # In-memory vector store + cosine similarity
│   │   ├── utils/
│   │   │   └── techDetector.ts # Tech stack detection from package.json + file patterns
│   │   ├── types/
│   │   │   └── index.ts        # Shared types (RepoFile, CodeChunk, RepoMetadata, etc.)
│   │   └── index.ts            # Express server + routes
│   ├── package.json
│   └── tsconfig.json
├── client/                      # React + Vite frontend
│   ├── src/
│   │   ├── components/          # UI components
│   │   ├── pages/               # Route pages
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
└── CLAUDE.md
```

## Build Order
1. **Server setup** — Express server, TypeScript config, project structure
2. **GitHub fetcher** — Octokit integration, URL parsing, file tree fetching, folder structure builder
3. **AST chunker** — Babel parsing, semantic chunking by fn/class/component/hook/type, large chunk splitting, fallback chunking
4. **Tech stack detector** — package.json scanner + file pattern detection
5. **Embeddings service** — Gemini embedding API integration for converting chunks to vectors
6. **Vector store** — In-memory storage, cosine similarity search, top-k retrieval
7. **LLM service** — Gemini Flash integration, prompt construction with retrieved chunks, streaming responses
8. **API routes** — POST /api/repos (ingest), GET /api/repos/:id/overview, POST /api/repos/:id/query, POST /api/repos/:id/change-guide
9. **Frontend** — Vite + React setup, GitHub URL input, repo overview dashboard, chat interface, React Flow diagrams
10. **Polish** — Loading states, error handling, responsive design

## Conventions
- TypeScript strict mode throughout
- ES modules
- Async/await over callbacks
- Descriptive variable names
- Error handling with try/catch at service boundaries
- No any types — use proper generics and type narrowing
