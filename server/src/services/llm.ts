import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { SearchResult } from "./vectorStore.js";
import type { RepoMetadata } from "../types/index.js";

const CHANGE_GUIDE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    filesToModify: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          filePath:   { type: SchemaType.STRING },
          reason:     { type: SchemaType.STRING },
          suggestion: { type: SchemaType.STRING },
        },
      },
    },
  },
};

const LLM_MODEL = "gemini-2.5-flash";

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return genAI.getGenerativeModel({ model: LLM_MODEL });
}

// Format retrieved chunks into a readable context block for the prompt.
// We include file path + score so the LLM can reference where things live.
function buildContext(results: SearchResult[]): string {
  return results
    .map((r, i) => {
      const header = `[${i + 1}] ${r.chunk.filePath} (${r.chunk.type}${r.chunk.name ? ` • ${r.chunk.name}` : ""}) — relevance: ${(r.score * 100).toFixed(0)}%`;
      return `${header}\n\`\`\`\n${r.chunk.content}\n\`\`\``;
    })
    .join("\n\n");
}

// --- Query: answer a free-form question about the codebase ---

export async function* streamAnswer(
  query: string,
  results: SearchResult[],
  metadata: RepoMetadata
): AsyncGenerator<string> {
  const model = getModel();

  const prompt = `You are an expert code assistant helping a developer understand the ${metadata.repo} codebase.

Tech stack: ${JSON.stringify(metadata.techStack)}

The following code snippets were retrieved as most relevant to the question:

${buildContext(results)}

Question: ${query}

Answer clearly and concisely. Reference specific file paths and function names where relevant.
If the retrieved snippets don't contain enough information to fully answer, say so honestly.
Do not make up code that isn't in the snippets above.`;

  try {
    const response = await model.generateContentStream(prompt);
    for await (const chunk of response.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  } catch (err) {
    console.error("Stream error:", err);
    yield "\n\n[Error: response was interrupted. Please try again.]";
  }
}

// --- Change guide: given a description of a change, identify files to modify ---

export async function generateChangeGuide(
  description: string,
  results: SearchResult[],
  metadata: RepoMetadata
): Promise<{
  summary: string;
  filesToModify: Array<{ filePath: string; reason: string; suggestion: string }>;
}> {
  const model = getModel();

  const prompt = `You are an expert code assistant helping a developer make a change to the ${metadata.repo} codebase.

Tech stack: ${JSON.stringify(metadata.techStack)}

The following code snippets are the most relevant to the requested change:

${buildContext(results)}

Requested change: ${description}

Return a JSON object with:
- "summary": a 1-2 sentence plain-English description of the overall approach
- "filesToModify": an array of objects, each with:
  - "filePath": the file to change (use exact paths from the snippets above)
  - "reason": why this file needs to change
  - "suggestion": a concrete, specific suggestion for what to add/change in this file

Only include files that genuinely need to change. Do not invent files not present in the snippets.`;

  const response = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: CHANGE_GUIDE_SCHEMA,
    },
  });

  const raw = response.response.text();
  return JSON.parse(raw) as {
    summary: string;
    filesToModify: Array<{ filePath: string; reason: string; suggestion: string }>;
  };
}
