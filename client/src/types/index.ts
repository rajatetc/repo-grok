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
}

export interface ChangeGuideResult {
  summary: string;
  filesToModify: Array<{
    filePath: string;
    reason: string;
    suggestion: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
