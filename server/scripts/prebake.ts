/**
 * Generates seed files for the example repos.
 *
 * Fetches repo → chunks → embeds → bakes canned answers → writes JSON.
 * Run once, commit the seeds, server loads them at startup with zero API calls.
 *
 * Usage:
 *   npm run prebake              # all repos
 *   npm run prebake -- redux     # just one repo
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchRepo } from "../src/services/github.js";
import { chunkFiles } from "../src/services/chunker.js";
import { detectTechStack } from "../src/utils/techDetector.js";
import { embedChunks, embedQuery } from "../src/services/embeddings.js";
import { storeChunks, search } from "../src/services/vectorStore.js";
import { streamAnswer } from "../src/services/llm.js";
import type { RepoMetadata, Source, CachedAnswer } from "../src/types/index.js";

const SUGGESTIONS = [
  "What are the main exports and how do they connect?",
  "Walk me through the core flow",
  "What patterns and abstractions does this use?",
];

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../seeds");

const ALL_EXAMPLES = [
  { owner: "reduxjs",    repo: "redux"   },
  { owner: "expressjs",  repo: "express" },
  { owner: "axios",      repo: "axios"   },
  { owner: "pmndrs",     repo: "zustand" },
  { owner: "colinhacks", repo: "zod"     },
];

const MAX_TOTAL_CHUNKS = 3000;
const TYPE_PRIORITY: Record<string, number> = { component: 0, hook: 1, function: 2, class: 3, type: 4 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gemini free tier: 5 req/min. Space out calls and retry on 429.
const GEMINI_DELAY_MS = 13_000;
const MAX_RETRIES = 3;



async function prebakeOne(owner: string, repo: string): Promise<void> {
  const url = `https://github.com/${owner}/${repo}`;
  const repoId = randomUUID();
  console.log(`\n▶ ${owner}/${repo}`);
  const startedAt = Date.now();

  const { files, branch, folderTree } = await fetchRepo(url);
  const sourceFiles = files.filter((f) => !f.path.endsWith("package.json"));
  console.log(`  Fetched ${files.length} files`);

  const chunks = chunkFiles(files);
  const techStack = detectTechStack(files);

  const sorted = [...chunks].sort((a, b) => (TYPE_PRIORITY[a.type] ?? 5) - (TYPE_PRIORITY[b.type] ?? 5));
  const truncated = sorted.length > MAX_TOTAL_CHUNKS;
  const chunksToEmbed = truncated ? sorted.slice(0, MAX_TOTAL_CHUNKS) : sorted;
  console.log(`  Parsed → ${chunks.length} chunks${truncated ? ` (capped to ${MAX_TOTAL_CHUNKS})` : ""}`);

  const embeddedChunks = await embedChunks(chunksToEmbed);

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

  // Bake canned answers
  storeChunks(repoId, embeddedChunks);
  const cachedAnswers: CachedAnswer[] = [];
  for (const question of SUGGESTIONS) {
    process.stdout.write(`  Q: ${question} ... `);
    const qVec = await embedQuery(question);
    const results = search(repoId, qVec);

    const seenFiles = new Set<string>();
    const sources: Source[] = [];
    for (const r of results) {
      if (seenFiles.has(r.chunk.filePath)) continue;
      seenFiles.add(r.chunk.filePath);
      sources.push({
        filePath: r.chunk.filePath,
        startLine: r.chunk.startLine,
        endLine: r.chunk.endLine,
        type: r.chunk.type,
        name: r.chunk.name,
      });
    }

    let answer = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        answer = "";
        for await (const piece of streamAnswer(question, results, metadata, [])) {
          answer += piece;
        }
        break;
      } catch (err: unknown) {
        if (attempt < MAX_RETRIES) {
          const wait = GEMINI_DELAY_MS * (attempt + 1);
          process.stdout.write(`error, retrying in ${wait / 1000}s ... `);
          await sleep(wait);
        } else {
          throw err;
        }
      }
    }

    cachedAnswers.push({ question, answer, sources });
    console.log(`${answer.length} chars`);
    await sleep(GEMINI_DELAY_MS);
  }

  const outPath = join(SEEDS_DIR, `${owner}-${repo}.json`);
  await writeFile(outPath, JSON.stringify({ repoId, url, metadata, chunks: embeddedChunks, cachedAnswers }), "utf-8");
  const elapsedMs = Date.now() - startedAt;
  console.log(`  ✓ ${owner}-${repo}.json (${(elapsedMs / 1000).toFixed(1)}s, ${embeddedChunks.length} chunks, ${cachedAnswers.length} answers)`);
}

async function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_AI_TOKEN) {
    console.error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN not set.");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set.");
    process.exit(1);
  }

  await mkdir(SEEDS_DIR, { recursive: true });

  const filter = process.argv.slice(2).map((s) => s.toLowerCase());
  const forceMode = filter.length > 0;
  const targets = forceMode
    ? ALL_EXAMPLES.filter((e) => filter.includes(e.repo.toLowerCase()))
    : ALL_EXAMPLES;

  if (targets.length === 0) {
    console.error(`No matching repos. Available: ${ALL_EXAMPLES.map((e) => e.repo).join(", ")}`);
    process.exit(1);
  }

  for (const { owner, repo } of targets) {
    if (!forceMode) {
      try {
        const raw = await readFile(join(SEEDS_DIR, `${owner}-${repo}.json`), "utf-8");
        const seed = JSON.parse(raw);
        const baked = new Set((seed.cachedAnswers ?? []).map((a: { question: string }) => a.question));
        if (SUGGESTIONS.every((q) => baked.has(q))) {
          console.log(`Skipping ${owner}/${repo} — already seeded with all questions`);
          continue;
        }
      } catch {}
    }
    await prebakeOne(owner, repo);
  }

  console.log("\n✓ Done. Commit the server/seeds/ directory.");
}

main().catch((err) => {
  console.error("\nPrebake failed:", err);
  process.exit(1);
});
