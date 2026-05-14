import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SearchResult } from "./vectorStore.js";
import type { RepoMetadata } from "../types/index.js";

const LLM_MODEL = "gemini-2.5-flash";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

function getModel(apiKey?: string, systemInstruction?: string) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("No Gemini API key available.");
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: LLM_MODEL,
    ...(systemInstruction ? { systemInstruction } : {}),
  });
}

function buildRepoContext(metadata: RepoMetadata): string {
  const { owner, repo, url, branch, fileCount, techStack, folderTree } = metadata;

  const stackParts: string[] = [];
  if (techStack.framework)                  stackParts.push(techStack.framework);
  if (techStack.buildTool)                  stackParts.push(techStack.buildTool);
  if (techStack.stateManagement?.length)    stackParts.push(...techStack.stateManagement);
  if (techStack.styling?.length)            stackParts.push(...techStack.styling);
  if (techStack.testing?.length)            stackParts.push(...techStack.testing);
  if (techStack.backend?.length)            stackParts.push(...techStack.backend);
  if (techStack.other?.length)              stackParts.push(...techStack.other);

  const topLevel = (folderTree.children ?? [])
    .filter((n) => n.type === "directory")
    .map((n) => `  ${n.name}/`)
    .join("\n");

  return [
    `Repository: ${owner}/${repo}`,
    `URL: ${url}`,
    `Branch: ${branch}`,
    `Files: ${fileCount} JS/TS source files`,
    stackParts.length ? `Tech stack: ${stackParts.join(", ")}` : null,
    topLevel ? `\nTop-level structure:\n${topLevel}` : null,
  ].filter(Boolean).join("\n");
}

function buildContext(results: SearchResult[]): string {
  return results
    .map((r, i) => {
      const header = `[${i + 1}] ${r.chunk.filePath} (${r.chunk.type}${r.chunk.name ? ` • ${r.chunk.name}` : ""}) — relevance: ${(r.score * 100).toFixed(0)}%`;
      return `${header}\n\`\`\`\n${r.chunk.content}\n\`\`\``;
    })
    .join("\n\n");
}

export async function* streamAnswer(
  query: string,
  results: SearchResult[],
  metadata: RepoMetadata,
  apiKey?: string,
  history: HistoryMessage[] = []
): AsyncGenerator<string> {
  const systemInstruction = `You are an expert code assistant helping a developer understand a codebase.

${buildRepoContext(metadata)}

Answer directly and concisely. Reference specific file paths and function names where relevant.
Never mention "the provided snippets", "the context", or how you retrieved the information — just answer as if you know the codebase.
If you don't have enough information to answer confidently, say so briefly.
Do not make up code that isn't in the context above.`;

  const model = getModel(apiKey, systemInstruction);

  // Convert to Gemini format: "assistant" → "model", skip empty messages
  const geminiHistory = history
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: (m.role === "user" ? "user" : "model") as "user" | "model",
      parts: [{ text: m.content }],
    }));

  // Gemini requires history to start with a user turn.
  // Drop any leading model turns that could appear if empty assistant
  // messages were filtered out on the client.
  const startIdx = geminiHistory.findIndex((m) => m.role === "user");
  const validHistory = startIdx <= 0 ? geminiHistory : geminiHistory.slice(startIdx);

  const chat = model.startChat({ history: validHistory });

  // RAG chunks are fresh per query — include them in the current message, not history
  const currentMessage =
    results.length > 0
      ? `Relevant code:\n\n${buildContext(results)}\n\nQuestion: ${query}`
      : query;

  const response = await chat.sendMessageStream(currentMessage);
  for await (const chunk of response.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
