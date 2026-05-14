import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const isDev = process.env.NODE_ENV !== "production";

function clientError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit")) {
      return "Gemini rate limit reached. Please wait a moment and try again.";
    }
    if (isDev) return msg;
  }
  return fallback;
}

import { fetchRepo } from "./services/github.js";
import { chunkFiles } from "./services/chunker.js";
import { detectTechStack } from "./utils/techDetector.js";
import { embedChunks, embedQuery, loadEmbeddingModel } from "./services/embeddings.js";
import { LRUCache } from "lru-cache";
import { storeChunks, search, hasRepo } from "./services/vectorStore.js";
import { streamAnswer } from "./services/llm.js";
import { loadSeeds } from "./services/seeds.js";
import { normalizeUrl } from "./utils/normalizeUrl.js";
import type { RepoMetadata } from "./types/index.js";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARN: GEMINI_API_KEY not set — chat and change-guide will fail, but indexing will work.");
}
if (!process.env.GITHUB_TOKEN) {
  console.warn("WARN: GITHUB_TOKEN is not set. GitHub API limited to 60 req/hr.");
}

const app = express();
const PORT = process.env.PORT ?? 3001;

const clientOrigin = process.env.CLIENT_URL ?? "http://localhost:5173";
if (!process.env.CLIENT_URL) {
  console.warn("WARN: CLIENT_URL not set, defaulting to http://localhost:5173");
}
app.use(cors({ origin: clientOrigin, allowedHeaders: ["Content-Type", "x-gemini-key"] }));
app.use(express.json({ limit: "100kb" }));

const MAX_REPOS = 50;

// --- Repo metadata store ---
const repoMetadataStore = new LRUCache<string, RepoMetadata>({ max: MAX_REPOS });

// --- URL dedup cache ---
// Normalized URL → repoId. Pre-populated with seeds on startup.
const urlCache = new LRUCache<string, string>({ max: MAX_REPOS });

// --- Rate limiters ---
// General limiter: protects against accidental loops / abusive clients.
// Ingest limiter is stricter: fetches a whole repo from GitHub and runs
// local CPU inference — more expensive than a single query.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many ingestion requests. Try again in an hour." },
});

app.use(generalLimiter);

// --- Routes ---

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// POST /api/repos — ingest a GitHub repo
app.post("/api/repos", ingestLimiter, async (req: Request, res: Response) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'url' in request body" });
  }

  const normalized = normalizeUrl(url);
  const cached = urlCache.get(normalized);
  if (cached && repoMetadataStore.has(cached)) {
    console.log(`Cache hit: ${url} → ${cached}`);
    return res.status(200).json({ repoId: cached, metadata: repoMetadataStore.get(cached) });
  }

  const repoId = randomUUID();
  const startedAt = Date.now();

  try {
    const { files, owner, repo, branch, folderTree } = await fetchRepo(url);

    const sourceFiles = files.filter((f) => !f.path.endsWith("package.json"));
    if (sourceFiles.length === 0) {
      return res.status(422).json({
        error: "No supported files found. RepoGrok supports JavaScript, TypeScript, HTML, CSS, Vue, and Svelte files. Python, Go, Rust coming soon.",
      });
    }

    const techStack = detectTechStack(files);
    const chunks = chunkFiles(files);

    const embeddedChunks = await embedChunks(chunks);

    // --- Extra stats ---
    const linesOfCode = sourceFiles.reduce((n, f) => n + f.content.split("\n").length, 0);

    let dependencyCount = 0;
    let devDependencyCount = 0;
    const pkgFile = files.find((f) => f.path === "package.json" || /^[^/]+\/package\.json$/.test(f.path));
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        dependencyCount    = Object.keys(pkg.dependencies    ?? {}).length;
        devDependencyCount = Object.keys(pkg.devDependencies ?? {}).length;
      } catch { /* ignore malformed package.json */ }
    }

    const chunkBreakdown = embeddedChunks.reduce(
      (acc, c) => {
        const key = c.type as keyof typeof acc;
        if (key in acc) acc[key]++;
        return acc;
      },
      { component: 0, hook: 0, function: 0, class: 0, type: 0 }
    );

    const metadata: RepoMetadata = {
      id: repoId,
      url,
      owner,
      repo,
      branch,
      fileCount: sourceFiles.length,
      totalChunks: embeddedChunks.length,
      techStack,
      folderTree,
      ingestedAt: new Date().toISOString(),
      linesOfCode,
      dependencyCount,
      devDependencyCount,
      chunkBreakdown,
    };
    storeChunks(repoId, embeddedChunks);
    repoMetadataStore.set(repoId, metadata);
    urlCache.set(normalized, repoId);

    const elapsedMs = Date.now() - startedAt;
    console.log(`Ingested ${owner}/${repo} in ${elapsedMs}ms — ${embeddedChunks.length} chunks`);

    return res.status(201).json({ repoId, metadata });
  } catch (err) {
    console.error(`Ingestion failed for ${url}:`, err);
    return res.status(500).json({ error: clientError(err, "Ingestion failed. Check the URL and try again.") });
  }
});

// GET /api/repos/:id/overview — repo overview
app.get("/api/repos/:id/overview", async (req: Request, res: Response) => {
  try {
    const metadata = repoMetadataStore.get(req.params.id);
    if (!metadata) {
      return res.status(404).json({ error: "Repo not found. It may have expired or never been ingested." });
    }
    return res.json(metadata);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

// POST /api/repos/:id/query — ask a question (streamed via SSE)
app.post("/api/repos/:id/query", async (req: Request, res: Response) => {
  const repoId = req.params.id;
  const { query } = req.body ?? {};

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'query' in request body" });
  }
  if (query.length > 2000) {
    return res.status(400).json({ error: "Query too long. Max 2000 characters." });
  }
  const metadata = repoMetadataStore.get(repoId);
  if (!metadata || !hasRepo(repoId)) {
    return res.status(404).json({ error: "Repo not found. It may have expired or never been ingested." });
  }

  // SSE handshake: text/event-stream + no-cache so proxies don't buffer,
  // keep-alive so the connection stays open across multiple `data:` frames.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });

  const userApiKey = req.headers["x-gemini-key"] as string | undefined;

  try {
    const queryVector = await embedQuery(query);
    const results = search(repoId, queryVector);

    for await (const textChunk of streamAnswer(query, results, metadata, userApiKey || undefined)) {
      if (clientClosed) return;
      // SSE frame format: `data: <payload>\n\n`. Both \n and \r terminate a
      // frame, so encode both — the client decodes on receive.
      const safe = textChunk.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
      res.write(`data: ${safe}\n\n`);
    }

    if (!clientClosed) {
      // Use a named SSE event so the done sentinel can't be spoofed by LLM
      // output containing the literal string `[DONE]`.
      res.write(`event: done\ndata: \n\n`);
      res.end();
    }
  } catch (err) {
    console.error("Query stream error:", err);
    if (!clientClosed) {
      const msg = clientError(err, "Something went wrong. Please try again.");
      res.write(`event: error\ndata: ${msg}\n\n`);
      res.end();
    }
  }
});


// --- Error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: clientError(err, "Internal server error") });
});

// Warm up the local embedding model and load pre-baked seeds in parallel
loadEmbeddingModel().catch((err) => console.warn("Embedding model failed to load:", err));

loadSeeds().then(({ urlMap, metadataMap }) => {
  for (const [url, id] of urlMap) urlCache.set(url, id);
  for (const [id, meta] of metadataMap) repoMetadataStore.set(id, meta);
  if (urlMap.size > 0) console.log(`${urlMap.size} seed(s) ready`);
}).catch((err) => console.warn("Seed loading failed:", err));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
