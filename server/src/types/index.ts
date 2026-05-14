export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface FolderNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FolderNode[];
}

export type ChunkType =
  | "component"
  | "hook"
  | "function"
  | "class"
  | "type"
  | "import"
  | "other";

export interface CodeChunk {
  id: string;
  filePath: string;
  content: string;
  type: ChunkType;
  name?: string;
  startLine: number;
  endLine: number;
  embedding?: number[];
}

export interface TechStack {
  framework?: string;
  stateManagement?: string[];
  styling?: string[];
  testing?: string[];
  buildTool?: string;
  backend?: string[];
  other?: string[];
}

export interface ChunkBreakdown {
  component: number;
  hook: number;
  function: number;
  class: number;
  type: number;
}

export interface RepoMetadata {
  id: string;
  url: string;
  owner: string;
  repo: string;
  branch: string;
  fileCount: number;
  totalChunks: number;
  techStack: TechStack;
  folderTree: FolderNode;
  ingestedAt: string;
  linesOfCode?: number;
  dependencyCount?: number;
  devDependencyCount?: number;
  chunkBreakdown?: ChunkBreakdown;
}

