import type { RepoFile } from "../types/index.js";

const PKG_PATTERN = /^([^/]+\/)?package\.json$/;

export function findPackageJson(files: RepoFile[]): RepoFile | undefined {
  return files.find((f) => PKG_PATTERN.test(f.path));
}

export interface ParsedPackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  allDeps: Set<string>;
}

export function parsePackageJson(content: string): ParsedPackageJson | null {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const dependencies = pkg.dependencies ?? {};
    const devDependencies = pkg.devDependencies ?? {};
    const peerDependencies = pkg.peerDependencies ?? {};
    return {
      dependencies,
      devDependencies,
      peerDependencies,
      allDeps: new Set([
        ...Object.keys(dependencies),
        ...Object.keys(devDependencies),
        ...Object.keys(peerDependencies),
      ]),
    };
  } catch {
    return null;
  }
}
