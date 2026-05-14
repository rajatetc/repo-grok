export interface TechStack {
  framework?: string;
  stateManagement?: string[];
  styling?: string[];
  testing?: string[];
  buildTool?: string;
  backend?: string[];
  other?: string[];
}

export interface FolderNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FolderNode[];
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


export interface Source {
  filePath: string;
  startLine: number;
  endLine: number;
  type: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}
