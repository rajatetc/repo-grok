/**
 * One-time script to pre-bake the 5 example repos.
 * Run with: npm run prebake
 *
 * Outputs JSON files to server/seeds/ — commit them to git so the
 * server can load them on startup without any Gemini API calls.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchRepo } from "../src/services/github.js";
import { chunkFiles } from "../src/services/chunker.js";
import { detectTechStack } from "../src/utils/techDetector.js";
import { embedChunks } from "../src/services/embeddings.js";
import type { RepoMetadata } from "../src/types/index.js";

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../seeds");

const EXAMPLES = [
  { owner: "reduxjs",   repo: "redux"   },
  { owner: "pmndrs",    repo: "zustand" },
  { owner: "expressjs", repo: "express" },
  { owner: "axios",     repo: "axios"   },
  { owner: "immerjs",   repo: "immer"   },
];

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
  console.log(`  Chunked → ${chunks.length} chunks`);

  const embeddedChunks = await embedChunks(chunks);
  console.log(`  Embedded ${embeddedChunks.length} chunks`);

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

  const seedData = { repoId, url, metadata, chunks: embeddedChunks };
  const outPath = join(SEEDS_DIR, `${owner}-${repo}.json`);
  await writeFile(outPath, JSON.stringify(seedData), "utf-8");
  console.log(`  Saved → seeds/${owner}-${repo}.json`);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set. Copy .env.example → .env and add your key.");
    process.exit(1);
  }

  await mkdir(SEEDS_DIR, { recursive: true });

  for (const { owner, repo } of EXAMPLES) {
    await prebakeOne(owner, repo);
  }

  console.log("\n✓ All seeds generated. Commit the server/seeds/ directory.");
}

main().catch((err) => {
  console.error("\nPrebake failed:", err);
  process.exit(1);
});
