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
    if (msg.includes("503") || msg.toLowerCase().includes("service unavailable") || msg.toLowerCase().includes("overloaded")) {
      return "Gemini is temporarily overloaded. Please try again in a moment.";
    }
    if (msg.toLowerCase().includes("failed to parse stream") || msg.toLowerCase().includes("parse stream")) {
      return "Response was cut short — Gemini dropped the stream. Try asking again.";
    }
    if (isDev) return msg;
  }
  return fallback;
}

import { fetchRepo } from "./services/github.js";
import { chunkFiles } from "./services/chunker.js";
import { detectTechStack } from "./utils/techDetector.js";
import { embedChunks, embedQuery } from "./services/embeddings.js";
import { LRUCache } from "lru-cache";
import { storeChunks, search, hasRepo } from "./services/vectorStore.js";
import { streamAnswer, type HistoryMessage } from "./services/llm.js";
import { loadSeeds } from "./services/seeds.js";
import { normalizeUrl } from "./utils/normalizeUrl.js";
import type { RepoMetadata } from "./types/index.js";

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARN: GEMINI_API_KEY not set — chat will fail.");
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_AI_TOKEN) {
  console.warn("WARN: Cloudflare credentials not set — ingestion will fail.");
}
if (!process.env.GITHUB_TOKEN) {
  console.warn("WARN: GITHUB_TOKEN is not set. GitHub API limited to 60 req/hr.");
}

const app = express();
const PORT = process.env.PORT ?? 3001;

// Render terminates TLS in a reverse proxy and forwards X-Forwarded-For.
// Trust one hop so express-rate-limit reads the real client IP without throwing.
app.set("trust proxy", 1);

const clientOrigin = process.env.CLIENT_URL ?? "http://localhost:5173";
if (!process.env.CLIENT_URL) {
  console.warn("WARN: CLIENT_URL not set, defaulting to http://localhost:5173");
}
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "100kb" }));

// Seeds are pinned for the process lifetime so example-chip clicks stay
// "instant." User-ingested repos live in a bounded LRU sized to stay
// comfortable on Render's 512MB free tier (see NOTES.md → Render 512MB tuning).
const USER_MAX_REPOS = 10;

const seedMetadata = new Map<string, RepoMetadata>();
const seedUrls = new Map<string, string>();
const userMetadata = new LRUCache<string, RepoMetadata>({ max: USER_MAX_REPOS });
const userUrls = new LRUCache<string, string>({ max: USER_MAX_REPOS });

function getMetadata(id: string): RepoMetadata | undefined {
  return seedMetadata.get(id) ?? userMetadata.get(id);
}
function getRepoIdByUrl(normalizedUrl: string): string | undefined {
  return seedUrls.get(normalizedUrl) ?? userUrls.get(normalizedUrl);
}

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
  max: 25,
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

  // SSE headers — all responses (cache hit or fresh ingest) stream through here
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  function emit(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const normalized = normalizeUrl(url);
  const cached = getRepoIdByUrl(normalized);
  const cachedMeta = cached ? getMetadata(cached) : undefined;
  if (cached && cachedMeta) {
    console.log(`Cache hit: ${url} → ${cached}`);
    emit("done", { repoId: cached, metadata: cachedMeta });
    res.end();
    return;
  }

  const repoId = randomUUID();
  const startedAt = Date.now();

  try {
    emit("progress", { stage: "fetch" });
    const { files, owner, repo, branch, folderTree } = await fetchRepo(url);

    const sourceFiles = files.filter((f) => !f.path.endsWith("package.json"));
    if (sourceFiles.length === 0) {
      emit("error", "No supported files found. RepoGrok supports JavaScript, TypeScript, HTML, CSS, Vue, and Svelte files. Python, Go, Rust coming soon.");
      res.end();
      return;
    }

    const techStack = detectTechStack(files);
    // Two emits: the first transitions the UI into "chunk" stage immediately
    // (chunking is sync and takes a few seconds for big repos), the second
    // updates the count once it's done. Without the first, the UI sits on
    // "fetch" through the entire AST parsing pass and feels stuck.
    emit("progress", { stage: "chunk" });
    const chunks = chunkFiles(files);
    emit("progress", { stage: "chunk", total: chunks.length });

    const MAX_TOTAL_CHUNKS = 3000;
    const TYPE_PRIORITY: Record<string, number> = { component: 0, hook: 1, function: 2, class: 3, type: 4 };
    const sorted = [...chunks].sort((a, b) => (TYPE_PRIORITY[a.type] ?? 5) - (TYPE_PRIORITY[b.type] ?? 5));
    const truncated = sorted.length > MAX_TOTAL_CHUNKS;
    const chunksToEmbed = truncated ? sorted.slice(0, MAX_TOTAL_CHUNKS) : sorted;
    if (truncated) {
      console.log(`Repo has ${chunks.length} chunks — truncating to ${MAX_TOTAL_CHUNKS} for performance`);
      emit("warning", `Repository has ${chunks.length.toLocaleString()} code chunks — only the top ${MAX_TOTAL_CHUNKS.toLocaleString()} are indexed. Some less important code may not appear in search results.`);
    }

    const embeddedChunks = await embedChunks(chunksToEmbed, (done, total) => {
      emit("progress", { stage: "embed", done, total });
    });

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
    userMetadata.set(repoId, metadata);
    userUrls.set(normalized, repoId);

    const elapsedMs = Date.now() - startedAt;
    console.log(`Ingested ${owner}/${repo} in ${elapsedMs}ms — ${embeddedChunks.length} chunks`);

    emit("done", { repoId, metadata });
    res.end();
  } catch (err) {
    console.error(`Ingestion failed for ${url}:`, err);
    emit("error", clientError(err, "Ingestion failed. Check the URL and try again."));
    res.end();
  }
});

// GET /api/repos/:id/overview — repo overview
app.get("/api/repos/:id/overview", async (req: Request, res: Response) => {
  try {
    const metadata = getMetadata(req.params.id);
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
  const { query, history } = req.body ?? {};

  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Missing or invalid 'query' in request body" });
  }
  if (query.length > 2000) {
    return res.status(400).json({ error: "Query too long. Max 2000 characters." });
  }

  const safeHistory: HistoryMessage[] = (Array.isArray(history) ? history : [])
    .filter(
      (m): m is HistoryMessage =>
        m !== null &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0 &&
        m.content.length <= 8000
    )
    .slice(-10);
  const metadata = getMetadata(repoId);
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

    // Score visibility for debugging weak retrieval. Top-3 scores tell you at
    // a glance whether the query matched anything in the repo at all — useful
    // when an answer feels vague and you want to know if it's the LLM or the
    // retrieval that fell short.
    const topScores = results.slice(0, 3).map((r) => r.score.toFixed(2)).join(", ");
    console.log(`Query "${query.slice(0, 60)}${query.length > 60 ? "…" : ""}" → ${results.length} chunks, top scores: [${topScores}]`);

    for await (const textChunk of streamAnswer(query, results, metadata, safeHistory)) {
      if (clientClosed) return;
      res.write(`data: ${JSON.stringify(textChunk)}\n\n`);
    }

    if (!clientClosed) {
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

loadSeeds().then(({ urlMap, metadataMap }) => {
  for (const [url, id] of urlMap) seedUrls.set(url, id);
  for (const [id, meta] of metadataMap) seedMetadata.set(id, meta);
  if (urlMap.size > 0) console.log(`${urlMap.size} seed(s) ready`);
}).catch((err) => console.warn("Seed loading failed:", err)).finally(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});

export default app;
