import * as babelParser from "@babel/parser";
import _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import crypto from "node:crypto";
import type { CodeChunk, ChunkType, RepoFile } from "../types/index.js";

// @babel/traverse has inconsistent ESM/CJS default export depending on environment
const traverse = (
  (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse
) as typeof _traverse;

// ~1000 tokens — safe to send to an LLM in a batch with other chunks
const MAX_CHUNK_SIZE = 4000;

// --- Type detection ---
// Figures out what kind of code a chunk is based on its name and AST node type.
// This label is stored with the chunk so we can filter by type during search.
function detectType(name: string | undefined, nodeType: string): ChunkType {
  if (nodeType === "ClassDeclaration" || nodeType === "ClassExpression") return "class";
  if (nodeType === "TSTypeAliasDeclaration" || nodeType === "TSInterfaceDeclaration") return "type";
  if (!name) return "function";
  if (/^[A-Z]/.test(name)) return "component"; // PascalCase → React component
  if (/^use[A-Z]/.test(name)) return "hook";   // useXxx → custom hook
  return "function";
}

// Only process top-level declarations. We don't want to chunk every nested helper
// inside a function — that would create thousands of tiny, low-value chunks.
function isTopLevel(path: NodePath): boolean {
  const parentType = path.parent.type;
  return parentType === "Program" || parentType === "ExportNamedDeclaration" || parentType === "ExportDefaultDeclaration";
}

// --- Large chunk splitting ---
// If a single function/class is huge (>4000 chars), we can't send it as one chunk.
// We split it at "logical boundaries" — blank lines or closing braces — so we
// don't cut mid-expression. Parts are named MyComponent_part0, MyComponent_part1, etc.
function splitLarge(
  content: string,
  filePath: string,
  name: string | undefined,
  type: ChunkType,
  startLine: number
): CodeChunk[] {
  const lines = content.split("\n");
  const result: CodeChunk[] = [];
  let segStart = 0;
  let segSize = 0;
  let part = 0;

  const flush = (end: number) => {
    const text = lines.slice(segStart, end + 1).join("\n").trim();
    if (text) {
      result.push({
        id: crypto.randomUUID(),
        filePath,
        content: text,
        type,
        name: name ? `${name}_part${part++}` : undefined,
        startLine: startLine + segStart,
        endLine: startLine + end,
      });
    }
    segStart = end + 1;
    segSize = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    segSize += lines[i].length + 1;
    const atBoundary = lines[i].trim() === "" || lines[i].trim() === "}";
    if ((segSize >= MAX_CHUNK_SIZE && atBoundary) || i === lines.length - 1) {
      flush(i);
    }
  }

  return result;
}

function makeChunks(
  text: string,
  filePath: string,
  name: string | undefined,
  type: ChunkType,
  startLine: number,
  endLine: number
): CodeChunk[] {
  if (text.length <= MAX_CHUNK_SIZE) {
    return [{ id: crypto.randomUUID(), filePath, content: text, type, name, startLine, endLine }];
  }
  return splitLarge(text, filePath, name, type, startLine);
}

// --- Babel parser setup ---
// We need different plugins per file type:
//   .ts/.tsx  → typescript plugin (strips types so Babel doesn't choke)
//   .jsx/.tsx → jsx plugin (understands <Component /> syntax)
// errorRecovery: true means one bad line won't abort the whole file
function parse(code: string, filePath: string) {
  const isTS = /\.[mc]?tsx?$/.test(filePath);
  const isJSX = /\.[jt]sx$/.test(filePath);

  return babelParser.parse(code, {
    sourceType: "module",
    errorRecovery: true,
    plugins: [
      ...(isTS ? (["typescript"] as const) : []),
      ...(isJSX ? (["jsx"] as const) : []),
      "decorators-legacy",
      "classProperties",
      "classStaticBlock",
      "exportDefaultFrom",
    ],
  });
}

// Last-resort fallback: if Babel can't parse the file at all, split it every ~50 lines.
// Dumb but ensures no file is silently dropped from the vector store.
function fallbackChunk(code: string, filePath: string): CodeChunk[] {
  const lines = code.split("\n");
  const chunkLines = Math.max(1, Math.floor(MAX_CHUNK_SIZE / 80));
  const result: CodeChunk[] = [];

  for (let i = 0; i < lines.length; i += chunkLines) {
    result.push({
      id: crypto.randomUUID(),
      filePath,
      content: lines.slice(i, i + chunkLines).join("\n"),
      type: "other",
      startLine: i + 1,
      endLine: Math.min(i + chunkLines, lines.length),
    });
  }

  return result;
}

// --- Main chunking logic ---

export function chunkFile(file: RepoFile): CodeChunk[] {
  const { path: filePath, content } = file;
  const chunks: CodeChunk[] = [];

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(content, filePath);
  } catch {
    // Babel couldn't parse at all — fall back to line splitting
    return fallbackChunk(content, filePath);
  }

  const slice = (start: number, end: number) => content.slice(start, end).trim();

  // All import lines at the top of a file are grouped into ONE chunk.
  // Splitting "import React" and "import useState" into separate chunks is useless.
  let importBatch: t.ImportDeclaration[] = [];

  const flushImports = () => {
    if (importBatch.length === 0) return;
    const first = importBatch[0];
    const last = importBatch[importBatch.length - 1];
    if (first.start == null || last.end == null) { importBatch = []; return; }
    chunks.push({
      id: crypto.randomUUID(),
      filePath,
      content: slice(first.start, last.end),
      type: "import",
      startLine: first.loc?.start.line ?? 1,
      endLine: last.loc?.end.line ?? 1,
    });
    importBatch = [];
  };

  try {
    traverse(ast, {
      // Collect imports — flushed as one chunk when we hit the first non-import node
      ImportDeclaration(path) {
        if (path.parent.type !== "Program") return;
        importBatch.push(path.node);
      },

      // Named functions: function myFn() {} / export function MyComponent() {}
      FunctionDeclaration(path) {
        if (!isTopLevel(path)) return;
        flushImports();
        const node = path.node;
        if (node.start == null || node.end == null) return;
        const name = node.id?.name;
        chunks.push(...makeChunks(
          slice(node.start, node.end), filePath, name,
          detectType(name, node.type),
          node.loc?.start.line ?? 1, node.loc?.end.line ?? 1
        ));
      },

      // Classes: class MyService {} / export class AuthProvider {}
      ClassDeclaration(path) {
        if (!isTopLevel(path)) return;
        flushImports();
        const node = path.node;
        if (node.start == null || node.end == null) return;
        chunks.push(...makeChunks(
          slice(node.start, node.end), filePath, node.id?.name, "class",
          node.loc?.start.line ?? 1, node.loc?.end.line ?? 1
        ));
      },

      // Arrow functions / function expressions assigned to a variable:
      // const MyComponent = () => {}  /  const useAuth = () => {}
      VariableDeclaration(path) {
        if (!isTopLevel(path)) return;
        const node = path.node;
        const decl = node.declarations[0];
        if (!decl) return;
        // Only chunk if the variable is assigned a function (not a string/object/etc.)
        if (!t.isArrowFunctionExpression(decl.init) && !t.isFunctionExpression(decl.init)) return;
        flushImports();
        if (node.start == null || node.end == null) return;
        const name = t.isIdentifier(decl.id) ? decl.id.name : undefined;
        chunks.push(...makeChunks(
          slice(node.start, node.end), filePath, name,
          detectType(name, "FunctionDeclaration"),
          node.loc?.start.line ?? 1, node.loc?.end.line ?? 1
        ));
      },

      // TypeScript type aliases: type ButtonProps = { color: string }
      TSTypeAliasDeclaration(path) {
        if (!isTopLevel(path)) return;
        flushImports();
        const node = path.node;
        if (node.start == null || node.end == null) return;
        chunks.push(...makeChunks(
          slice(node.start, node.end), filePath, node.id.name, "type",
          node.loc?.start.line ?? 1, node.loc?.end.line ?? 1
        ));
      },

      // TypeScript interfaces: interface User { id: string }
      TSInterfaceDeclaration(path) {
        if (!isTopLevel(path)) return;
        flushImports();
        const node = path.node;
        if (node.start == null || node.end == null) return;
        chunks.push(...makeChunks(
          slice(node.start, node.end), filePath, node.id.name, "type",
          node.loc?.start.line ?? 1, node.loc?.end.line ?? 1
        ));
      },
    });
  } catch {
    return fallbackChunk(content, filePath);
  }

  // Flush any trailing imports (files that are only imports, like barrel files)
  flushImports();

  return chunks.length > 0 ? chunks : fallbackChunk(content, filePath);
}

// Entry point: chunk every file in the repo, skipping any that fail
export function chunkFiles(files: RepoFile[]): CodeChunk[] {
  return files.flatMap((file) => {
    try {
      return chunkFile(file);
    } catch {
      console.warn(`Chunking failed for ${file.path}, skipping`);
      return [];
    }
  });
}
