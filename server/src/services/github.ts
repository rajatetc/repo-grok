import AdmZip from "adm-zip";
import { Octokit } from "@octokit/rest";
import type { RepoFile, FolderNode } from "../types/index.js";

const ALLOWED_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx",   // JavaScript / TypeScript
  ".html", ".htm",                 // HTML
  ".css", ".scss", ".sass", ".less", // CSS & preprocessors
  ".vue", ".svelte",               // component formats (line-chunked)
]);
const MAX_FILE_SIZE = 500 * 1024; // 500KB

// Directory segments that should never be traversed
const IGNORED_DIRS = new Set([
  "node_modules", "dist", "build", ".next", "out", "coverage",
  "__mocks__", "fixtures", "__fixtures__", "website",
]);

// Exact filenames to skip
const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
]);

export function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  branch?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Invalid GitHub URL");
  }

  if (parsed.protocol !== "https:") throw new Error("Invalid GitHub URL");
  if (parsed.hostname !== "github.com") throw new Error("Invalid GitHub URL");
  if (parsed.username !== "" || parsed.password !== "") throw new Error("Invalid GitHub URL");

  const pathname = parsed.pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");

  const parts = pathname.split("/");
  if (parts.length < 2) throw new Error("Invalid GitHub URL");

  const owner = parts[0];
  const repo = parts[1];

  const ownerRepoPattern = /^[A-Za-z0-9._-]{1,100}$/;
  if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo)) {
    throw new Error("Invalid GitHub URL");
  }

  let branch: string | undefined;
  if (parts.length > 2) {
    if (parts[2] !== "tree" || parts.length < 4) {
      throw new Error(`Invalid GitHub URL for ${owner}/${repo}`);
    }
    branch = parts.slice(3).join("/");
    const branchPattern = /^[A-Za-z0-9._\-\/]{1,250}$/;
    if (!branchPattern.test(branch) || branch.includes("..")) {
      throw new Error(`Invalid GitHub URL for ${owner}/${repo}`);
    }
  }

  return { owner, repo, branch };
}

function getExtension(filePath: string): string {
  const filename = filePath.split("/").pop() ?? "";
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

function isAllowedFile(path: string): boolean {
  const segments = path.split("/");
  const filename = segments[segments.length - 1];
  if (segments.slice(0, -1).some(s => IGNORED_DIRS.has(s))) return false;
  if (IGNORED_FILES.has(filename)) return false;
  if (filename.includes(".min.")) return false;
  if (filename === "package.json") return true;
  return ALLOWED_EXTENSIONS.has(getExtension(path));
}

async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

// Download the full repo as a zip archive — one HTTP call, no per-file API requests.
// GitHub returns a 302 → CDN redirect; fetch follows it automatically.
// The zip has a single top-level folder "{owner}-{repo}-{sha}/"; we strip it.
async function downloadZip(
  owner: string,
  repo: string,
  branch: string
): Promise<RepoFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "RepoGrok/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`GitHub archive download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // Derive the prefix from the first entry (e.g. "facebook-react-a1b2c3/")
  const prefix = (entries[0]?.entryName.split("/")[0] ?? "") + "/";

  const MAX_TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB uncompressed across all processed files
  let totalBytes = 0;

  const files: RepoFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const path = entry.entryName.slice(prefix.length);
    if (!path || !isAllowedFile(path)) continue;

    const size = entry.header.size; // uncompressed size from zip directory (no decompression)
    if (size > MAX_FILE_SIZE) continue;
    if (totalBytes + size > MAX_TOTAL_BYTES) continue;

    try {
      const content = entry.getData().toString("utf-8");
      files.push({ path, content, size });
      totalBytes += size;
    } catch {
      // skip unreadable entries (corrupt or binary despite extension match)
    }
  }

  return files;
}

export function buildFolderTree(files: RepoFile[]): FolderNode {
  const root: FolderNode = { name: "", path: "", type: "directory", children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const currentPath = parts.slice(0, i + 1).join("/");
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        node.children!.push({ name: part, path: currentPath, type: "file" });
      } else {
        let dir = node.children!.find((c) => c.type === "directory" && c.name === part);
        if (!dir) {
          dir = { name: part, path: currentPath, type: "directory", children: [] };
          node.children!.push(dir);
        }
        node = dir;
      }
    }
  }

  return root;
}

export async function fetchRepo(url: string): Promise<{
  files: RepoFile[];
  owner: string;
  repo: string;
  branch: string;
  folderTree: FolderNode;
}> {
  const parsed = parseGitHubUrl(url);
  const { owner, repo } = parsed;
  const branch = parsed.branch ?? (await getDefaultBranch(owner, repo));

  console.log(`Fetching ${owner}/${repo}@${branch}…`);

  const files = await downloadZip(owner, repo, branch);
  console.log(`Extracted ${files.length} files`);

  const folderTree = buildFolderTree(files);
  return { files, owner, repo, branch, folderTree };
}
