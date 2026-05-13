/**
 * Generates seed files for the example repos in server/seeds/.
 * Commit the resulting JSON files — the server loads them on startup
 * with zero Gemini API calls.
 *
 * Usage:
 *   npm run prebake              # bake all repos not yet seeded
 *   npm run prebake -- immer     # bake a single repo by name
 *
 * Free tier limits: ~100 RPM, 1000 req/day per Google project.
 * Estimated calls: immer~100, zustand~200, express~300, axios~300, redux~400.
 * Run in two batches across two days if needed:
 *   Day 1: npm run prebake -- immer zustand express   (~600 calls)
 *   Day 2: npm run prebake -- axios redux             (~700 calls)
 */
import "dotenv/config";
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
  { owner: "pmndrs",    repo: "zustand" },
  { owner: "expressjs", repo: "express" },
  { owner: "axios",     repo: "axios"   },
  { owner: "immerjs",   repo: "immer"   },
];

// 90s between repos — lets the 1-min RPM window fully reset
const INTER_REPO_DELAY_MS = 90_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const repoId = `seed-${owner}-${repo}`;
  console.log(`\n▶ ${owner}/${repo}`);

  const { files, branch, folderTree } = await fetchRepo(url);
  console.log(`  Fetched ${files.length} files`);

  const [chunks, techStack] = await Promise.all([
    Promise.resolve(chunkFiles(files)),
    detectTechStack(files),
  ]);
  console.log(`  Parsed → ${chunks.length} chunks (~${chunks.length} embedding calls)`);

  const embeddedChunks = await embedChunks(chunks);

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

  const outPath = join(SEEDS_DIR, `${owner}-${repo}.json`);
  await writeFile(outPath, JSON.stringify({ repoId, url, metadata, chunks: embeddedChunks }), "utf-8");
  console.log(`  ✓ Saved seeds/${owner}-${repo}.json`);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set.");
    process.exit(1);
  }

  await mkdir(SEEDS_DIR, { recursive: true });

  // Allow filtering by repo name via CLI args: npm run prebake -- immer zustand
  const filter = process.argv.slice(2).map((s) => s.toLowerCase());
  const targets = filter.length
    ? ALL_EXAMPLES.filter((e) => filter.includes(e.repo.toLowerCase()))
    : ALL_EXAMPLES;

  if (targets.length === 0) {
    console.error(`No matching repos found. Available: ${ALL_EXAMPLES.map((e) => e.repo).join(", ")}`);
    process.exit(1);
  }

  let queued = 0;
  for (const { owner, repo } of targets) {
    if (await alreadySeeded(owner, repo)) {
      console.log(`Skipping ${owner}/${repo} — seed already exists`);
      continue;
    }
    queued++;

    if (queued > 1) {
      console.log(`\nWaiting ${INTER_REPO_DELAY_MS / 1000}s to let the RPM window reset…`);
      await sleep(INTER_REPO_DELAY_MS);
    }

    await prebakeOne(owner, repo);
  }

  if (queued === 0) {
    console.log("\nAll selected repos are already seeded. Nothing to do.");
  } else {
    console.log("\n✓ Done. Commit the server/seeds/ directory.");
  }
}

main().catch((err) => {
  console.error("\nPrebake failed:", err);
  process.exit(1);
});
