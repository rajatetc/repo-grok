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
  const cleaned = url.trim().replace(/\/$/, "");
  const match = cleaned.match(
    /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?/
  );
  if (!match) throw new Error(`Invalid GitHub URL: ${url}`);
  return { owner: match[1], repo: match[2], branch: match[3] };
}

function isAllowedFile(path: string): boolean {
  if (IGNORED_PATHS.some((p) => path.includes(p))) return false;
  const ext = path.slice(path.lastIndexOf("."));
  return ALLOWED_EXTENSIONS.has(ext);
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
  path: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || data.type !== "file") return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

async function fetchFilesInBatches(
  octokit: Octokit,
  owner: string,
  repo: string,
  files: Array<{ path: string; size: number }>
): Promise<RepoFile[]> {
  const results: RepoFile[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(async ({ path, size }) => {
        const content = await fetchFileContent(octokit, owner, repo, path);
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

  const files = await fetchFilesInBatches(octokit, owner, repo, fileMeta);
  console.log(`Fetched content for ${files.length} files`);

  const folderTree = buildFolderTree(files);

  return { files, owner, repo, branch, folderTree };
}
