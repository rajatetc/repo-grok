import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { TechStack, RepoFile } from "../types/index.js";

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    framework:       { type: SchemaType.STRING,  nullable: true, description: "Primary frontend framework (e.g. Next.js, React, Vue)" },
    stateManagement: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true, description: "State management libraries" },
    styling:         { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true, description: "CSS/styling libraries" },
    testing:         { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true, description: "Testing frameworks and tools" },
    buildTool:       { type: SchemaType.STRING,  nullable: true, description: "Primary build tool (e.g. Vite, Webpack)" },
    backend:         { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true, description: "Backend frameworks, ORMs, and server libs" },
    other:           { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, nullable: true, description: "Any other notable libraries worth mentioning" },
  },
};

export async function detectTechStack(files: RepoFile[]): Promise<TechStack> {
  const pkgFile = files.find((f) => f.path === "package.json");

  // Collect config file names — gives Gemini extra signal beyond package.json
  // e.g. tailwind.config.ts, next.config.js, prisma/schema.prisma
  const configFiles = files
    .map((f) => f.path)
    .filter((p) => !p.includes("node_modules") && (
      p.endsWith(".config.ts") ||
      p.endsWith(".config.js") ||
      p.endsWith(".config.mjs") ||
      p.endsWith("schema.prisma") ||
      p.endsWith(".eslintrc") ||
      p.endsWith(".eslintrc.js") ||
      p.endsWith(".eslintrc.json")
    ));

  const prompt = `
You are a tech stack detector. Given a JavaScript/TypeScript project's package.json and a list of config files, identify the tech stack.

${pkgFile ? `package.json:\n\`\`\`json\n${pkgFile.content}\n\`\`\`` : "No package.json found."}

${configFiles.length > 0 ? `Config files present:\n${configFiles.join("\n")}` : ""}

Return only what you are confident about. Use well-known human-readable names (e.g. "Next.js" not "next", "Tailwind CSS" not "tailwindcss").
For "other", include notable infrastructure libs like tRPC, GraphQL, Socket.io, Stripe, etc. — skip generic utilities.
`.trim();

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as TechStack;

    // Strip nulls and empty arrays Gemini may return
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => {
        if (v === null || v === undefined) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      })
    ) as TechStack;

  } catch (err) {
    console.warn("Tech stack detection failed:", err);
    return {};
  }
}
