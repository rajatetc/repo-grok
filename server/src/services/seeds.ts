import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoMetadata, CodeChunk } from "../types/index.js";
import { storeChunks } from "./vectorStore.js";
import { normalizeUrl } from "../utils/normalizeUrl.js";

const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../seeds");

interface SeedFile {
  repoId: string;
  url: string;
  metadata: RepoMetadata;
  chunks: CodeChunk[];
}

interface LoadedSeeds {
  urlMap: Map<string, string>;
  metadataMap: Map<string, RepoMetadata>;
}

export async function loadSeeds(): Promise<LoadedSeeds> {
  const urlMap = new Map<string, string>();
  const metadataMap = new Map<string, RepoMetadata>();

  let files: string[];
  try {
    files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return { urlMap, metadataMap }; // seeds dir doesn't exist yet — fine
  }

  for (const file of files) {
    try {
      const raw = await readFile(join(SEEDS_DIR, file), "utf-8");
      const seed: SeedFile = JSON.parse(raw);

      storeChunks(seed.repoId, seed.chunks);
      metadataMap.set(seed.repoId, seed.metadata);
      urlMap.set(normalizeUrl(seed.url), seed.repoId);

      console.log(`Seed loaded: ${seed.metadata.owner}/${seed.metadata.repo} — ${seed.chunks.length} chunks`);
    } catch (err) {
      console.warn(`Failed to load seed ${file}:`, err);
    }
  }

  return { urlMap, metadataMap };
}
