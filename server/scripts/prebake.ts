/**
 * Generates seed files for the example repos.
 *
 * Why this exists: Re-indexing the example repos on every cold boot would
 * slow first-visit UX. Instead we run this script offline once, commit the
 * resulting JSONs, and the server loads them at startup with zero API calls.
 *
 * Usage:
 *   npm run prebake              # all repos missing a seed file
 *   npm run prebake -- redux     # force just one (overwrites)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchRepo } from "../src/services/github.js";
import { chunkFiles } from "../src/services/chunker.js";
import { detectTechStack } from "../src/utils/techDetector.js";
import { embedChunks } from "../src/services/embeddings.js";
import type { RepoMetadata } from "../src/types/index.js";

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

  const outPath = join(SEEDS_DIR, `${owner}-${repo}.json`);
  await writeFile(outPath, JSON.stringify({ repoId, url, metadata, chunks: embeddedChunks }), "utf-8");
  const elapsedMs = Date.now() - startedAt;
  console.log(`  ✓ Saved seeds/${owner}-${repo}.json (${(elapsedMs / 1000).toFixed(1)}s, ${embeddedChunks.length} chunks)`);
}

async function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_AI_TOKEN) {
    console.error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN not set.");
    process.exit(1);
  }

  await mkdir(SEEDS_DIR, { recursive: true });

  const filter = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = filter.length
    ? ALL_EXAMPLES.filter((e) => filter.includes(e.repo.toLowerCase()))
    : ALL_EXAMPLES;

  if (targets.length === 0) {
    console.error(`No matching repos found. Available: ${ALL_EXAMPLES.map((e) => e.repo).join(", ")}`);
    process.exit(1);
  }

  const forceAll = filter.length > 0; // explicit names = always overwrite
  let processed = 0;

  for (const { owner, repo } of targets) {
    if (!forceAll && (await alreadySeeded(owner, repo))) {
      console.log(`Skipping ${owner}/${repo} — seed already exists (pass repo name to force)`);
      continue;
    }
    await prebakeOne(owner, repo);
    processed++;
  }

  if (processed === 0) {
    console.log("\nAll selected repos already seeded.");
  } else {
    console.log("\n✓ Done. Commit the server/seeds/ directory.");
  }
}

main().catch((err) => {
  console.error("\nPrebake failed:", err);
  process.exit(1);
});
