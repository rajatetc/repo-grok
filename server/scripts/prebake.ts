/**
 * Generates seed files for the example repos.
 *
 * Why this exists: Re-indexing the example repos on every cold boot would
 * slow first-visit UX. Instead we run this script offline once, commit the
 * resulting JSONs, and the server loads them at startup with zero API calls.
 *
 * Usage:
 *   npm run prebake                       # all repos missing a seed file
 *   npm run prebake -- redux              # force re-bake of one (overwrites everything)
 *   npm run prebake -- --answers          # add/refresh canned-question answers
 *                                         #   on existing seeds (skips fetch/chunk/embed
 *                                         #   of chunks — saves Cloudflare neurons)
 *   npm run prebake -- --answers redux    # same, just one repo
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchRepo } from "../src/services/github.js";
import { chunkFiles } from "../src/services/chunker.js";
import { detectTechStack } from "../src/utils/techDetector.js";
import { embedChunks, embedQuery } from "../src/services/embeddings.js";
import { storeChunks, search } from "../src/services/vectorStore.js";
import { streamAnswer } from "../src/services/llm.js";
import type { RepoMetadata, Source, CachedAnswer, CodeChunk } from "../src/types/index.js";

// Mirror of client/src/components/ChatTab.tsx `SUGGESTIONS`. Keep in sync —
// these are the canned questions surfaced as chips on the empty chat state.
// Baking answers for them lets the demo serve instant, deterministic responses
// without hitting Gemini at runtime (and survives Gemini quota outages).
const SUGGESTIONS = [
  "How is the code structured?",
  "Walk me through the core flow",
  "How are errors handled?",
];

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../seeds");

const ALL_EXAMPLES = [
  { owner: "reduxjs",   repo: "redux"   },
  { owner: "expressjs", repo: "express" },
  { owner: "axios",     repo: "axios"   },
];

const MAX_TOTAL_CHUNKS = 3000;
const TYPE_PRIORITY: Record<string, number> = { component: 0, hook: 1, function: 2, class: 3, type: 4 };



async function alreadySeeded(owner: string, repo: string): Promise<boolean> {
  try {
    await access(join(SEEDS_DIR, `${owner}-${repo}.json`));
    return true;
  } catch {
    return false;
  }
}

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

  // Bake answers for the canned chip questions. Stored alongside the chunks
  // so the runtime serves them without an embed or Gemini call.
  const cachedAnswers = await bakeCachedAnswers(metadata, embeddedChunks);

  const outPath = join(SEEDS_DIR, `${owner}-${repo}.json`);
  await writeFile(outPath, JSON.stringify({ repoId, url, metadata, chunks: embeddedChunks, cachedAnswers }), "utf-8");
  const elapsedMs = Date.now() - startedAt;
  console.log(`  ✓ Saved seeds/${owner}-${repo}.json (${(elapsedMs / 1000).toFixed(1)}s, ${embeddedChunks.length} chunks, ${cachedAnswers.length} cached answers)`);
}

async function bakeCachedAnswers(metadata: RepoMetadata, chunks: CodeChunk[]): Promise<CachedAnswer[]> {
  const repoId = metadata.id;
  storeChunks(repoId, chunks);
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
    for await (const piece of streamAnswer(question, results, metadata, [])) {
      answer += piece;
    }
    cachedAnswers.push({ question, answer, sources });
    console.log(`${answer.length} chars`);
  }
  return cachedAnswers;
}

async function refreshAnswersOnly(owner: string, repo: string): Promise<boolean> {
  const seedPath = join(SEEDS_DIR, `${owner}-${repo}.json`);
  let raw: string;
  try {
    raw = await readFile(seedPath, "utf-8");
  } catch {
    console.log(`Skipping ${owner}/${repo} — no seed file (run a full prebake first)`);
    return false;
  }
  const seed = JSON.parse(raw);
  console.log(`\n▶ ${owner}/${repo} (answers only, ${seed.chunks.length} chunks unchanged)`);
  const startedAt = Date.now();

  const cachedAnswers = await bakeCachedAnswers(seed.metadata, seed.chunks);
  seed.cachedAnswers = cachedAnswers;
  await writeFile(seedPath, JSON.stringify(seed), "utf-8");

  const elapsedMs = Date.now() - startedAt;
  console.log(`  ✓ Refreshed seeds/${owner}-${repo}.json (${(elapsedMs / 1000).toFixed(1)}s, ${cachedAnswers.length} cached answers)`);
  return true;
}

async function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_AI_TOKEN) {
    console.error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN not set.");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set (needed to bake canned-question answers).");
    process.exit(1);
  }

  await mkdir(SEEDS_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const answersOnly = args.includes("--answers") || args.includes("--answers-only");
  const filter = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());

  const targets = filter.length
    ? ALL_EXAMPLES.filter((e) => filter.includes(e.repo.toLowerCase()))
    : ALL_EXAMPLES;

  if (targets.length === 0) {
    console.error(`No matching repos found. Available: ${ALL_EXAMPLES.map((e) => e.repo).join(", ")}`);
    process.exit(1);
  }

  let processed = 0;

  if (answersOnly) {
    for (const { owner, repo } of targets) {
      const ok = await refreshAnswersOnly(owner, repo);
      if (ok) processed++;
    }
  } else {
    const forceAll = filter.length > 0; // explicit names = always overwrite
    for (const { owner, repo } of targets) {
      if (!forceAll && (await alreadySeeded(owner, repo))) {
        console.log(`Skipping ${owner}/${repo} — seed already exists (pass repo name to force)`);
        continue;
      }
      await prebakeOne(owner, repo);
      processed++;
    }
  }

  if (processed === 0) {
    console.log("\nNothing processed.");
  } else {
    console.log("\n✓ Done. Commit the server/seeds/ directory.");
  }
}

main().catch((err) => {
  console.error("\nPrebake failed:", err);
  process.exit(1);
});
