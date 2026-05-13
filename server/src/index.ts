import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const isDev = process.env.NODE_ENV !== "production";

// In dev: return real error message so you can debug without reading server logs.
// In prod: return generic message so internals aren't leaked to end users.
function clientError(err: unknown, fallback: string): string {
  if (isDev && err instanceof Error) return err.message;
  return fallback;
}

import { fetchRepo } from "./services/github.js";
import { chunkFiles } from "./services/chunker.js";
import { detectTechStack } from "./utils/techDetector.js";
import { embedChunks, embedQuery } from "./services/embeddings.js";
import { storeChunks, search, hasRepo } from "./services/vectorStore.js";
import { streamAnswer, generateChangeGuide } from "./services/llm.js";
import type { RepoMetadata } from "./types/index.js";

if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
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
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "100kb" }));

// --- Repo metadata store ---
// Lives alongside the vector store (which holds chunks). Same lifetime, same process.
// Keyed by the repoId we hand back to the client after ingestion.
const repoMetadataStore = new Map<string, RepoMetadata>();

// --- URL dedup cache ---
// Normalized URL → repoId so re-submitting the same repo is instant.
const urlCache = new Map<string, string>();

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/$/, "");
}

// --- Rate limiters ---
// General limiter: protects against accidental loops / abusive clients.
// Ingest limiter is stricter because ingestion pulls a whole repo, embeds every
// chunk, and burns Gemini quota — far more expensive than a single query.
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

    // Chunking and tech detection are independent — run them in parallel.
    const [chunks, techStack] = await Promise.all([
      Promise.resolve(chunkFiles(files)),
      detectTechStack(files),
    ]);

    const embeddedChunks = await embedChunks(chunks);
    storeChunks(repoId, embeddedChunks);

    const metadata: RepoMetadata = {
      id: repoId,
      url,
      owner,
      repo,
      branch,
      fileCount: files.length,
      totalChunks: embeddedChunks.length,
      techStack,
      folderTree,
      ingestedAt: new Date().toISOString(),
    };
    repoMetadataStore.set(repoId, metadata);
    urlCache.set(normalized, repoId);

    const elapsedMs = Date.now() - startedAt;
    console.log(`Ingested ${owner}/${repo} in ${elapsedMs}ms — ${embeddedChunks.length} chunks`);

    return res.status(201).json({ repoId, metadata });
  } catch (err) {
    console.error(`Ingestion failed for ${url}:`, err);
    // Surface Gemini quota errors directly — they're actionable for the user
    if ((err as { status?: number }).status === 429) {
      return res.status(503).json({
        error: "Gemini API quota limit reached. This usually resets within a minute — please try again shortly.",
      });
    }
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

  try {
    const queryVector = await embedQuery(query);
    const results = search(repoId, queryVector);

    for await (const textChunk of streamAnswer(query, results, metadata)) {
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
      res.write(`event: error\ndata: Something went wrong\n\n`);
      res.end();
    }
  }
});

// POST /api/repos/:id/change-guide — describe a change, get guidance
app.post("/api/repos/:id/change-guide", async (req: Request, res: Response) => {
  const repoId = req.params.id;
  const { description } = req.body ?? {};

  if (!description || typeof description !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'description' in request body" });
  }
  if (description.length > 2000) {
    return res.status(400).json({ error: "Query too long. Max 2000 characters." });
  }
  const metadata = repoMetadataStore.get(repoId);
  if (!metadata || !hasRepo(repoId)) {
    return res.status(404).json({ error: "Repo not found. It may have expired or never been ingested." });
  }

  try {
    const queryVector = await embedQuery(description);
    const results = search(repoId, queryVector);
    const guide = await generateChangeGuide(description, results, metadata);
    return res.json(guide);
  } catch (err) {
    console.error("Change guide failed:", err);
    return res.status(500).json({ error: clientError(err, "Failed to generate change guide.") });
  }
});

// --- Error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: clientError(err, "Internal server error") });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
