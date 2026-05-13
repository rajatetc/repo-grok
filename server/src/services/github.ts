import { Octokit } from "@octokit/rest";
import type { RepoFile, FolderNode } from "../types/index.js";

const ALLOWED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const MAX_FILE_SIZE = 500 * 1024; // 500KB
const BATCH_SIZE = 10;

// Only skip truly irrelevant content: third-party code, compiled output, and lock files
const IGNORED_PATHS = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".min.", // minified files
];

function createOctokit(): Octokit {
  return new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });
}

export function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  branch?: string;
} {
  // Parse via WHATWG URL so we can enforce protocol/hostname and reject
  // credentials embedded in the URL (e.g. https://x-access-token:TOKEN@github.com/...).
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Invalid GitHub URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Invalid GitHub URL");
  }
  if (parsed.hostname !== "github.com") {
    throw new Error("Invalid GitHub URL");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    // Never log the raw URL — it may contain a token.
    throw new Error("Invalid GitHub URL");
  }

  // Strip leading slash, trailing slash, and a trailing `.git` from the path.
  const pathname = parsed.pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");

  const parts = pathname.split("/");
  if (parts.length < 2) {
    throw new Error("Invalid GitHub URL");
  }

  const owner = parts[0];
  const repo = parts[1];

  const ownerRepoPattern = /^[A-Za-z0-9._-]{1,100}$/;
  if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo)) {
    throw new Error("Invalid GitHub URL");
  }

  let branch: string | undefined;
  if (parts.length > 2) {
    // Expect `/tree/<branch>` after owner/repo. Anything else is invalid.
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
  // dot > 0 excludes dotfiles like .eslintrc (dot at index 0 = no real extension)
  return dot > 0 ? filename.slice(dot) : "";
}

function isAllowedFile(path: string): boolean {
  if (IGNORED_PATHS.some((p) => path.includes(p))) return false;
  return ALLOWED_EXTENSIONS.has(getExtension(path));
}

async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

async function fetchFilePaths(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<Array<{ path: string; size: number; sha: string }>> {
  const { data } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "1",
  });

  if (data.truncated) {
    console.warn("Git tree was truncated — very large repo, some files skipped");
  }

  return (data.tree ?? [])
    .filter(
      (item) =>
        item.type === "blob" &&
        item.path != null &&
        item.size != null &&
        item.size <= MAX_FILE_SIZE &&
        isAllowedFile(item.path)
    )
    .map((item) => ({
      path: item.path!,
      size: item.size!,
      sha: item.sha!,
    }));
}

async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    // ref: branch ensures we fetch from the correct branch, not always default
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(data) || data.type !== "file") return null;
    if (!data.content) return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) console.warn(`Failed to fetch ${path} (${status})`);
    return null;
  }
}

async function fetchFilesInBatches(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; size: number }>
): Promise<RepoFile[]> {
  const results: RepoFile[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(async ({ path, size }) => {
        const content = await fetchFileContent(octokit, owner, repo, path, branch);
        return content != null ? { path, content, size } : null;
      })
    );
    results.push(...(fetched.filter(Boolean) as RepoFile[]));
  }

  return results;
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
        let dir = node.children!.find(
          (c) => c.type === "directory" && c.name === part
        );
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
  const octokit = createOctokit();
  const parsed = parseGitHubUrl(url);
  const { owner, repo } = parsed;
  const branch = parsed.branch ?? (await getDefaultBranch(octokit, owner, repo));

  console.log(`Fetching ${owner}/${repo}@${branch}...`);

  const fileMeta = await fetchFilePaths(octokit, owner, repo, branch);
  console.log(`Found ${fileMeta.length} eligible files`);

  const files = await fetchFilesInBatches(octokit, owner, repo, branch, fileMeta);
  console.log(`Fetched content for ${files.length} files`);

  const folderTree = buildFolderTree(files);

  return { files, owner, repo, branch, folderTree };
}
