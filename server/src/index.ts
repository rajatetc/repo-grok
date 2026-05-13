import "dotenv/config";
import express from "express";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";

if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}
if (!process.env.GITHUB_TOKEN) {
  console.warn("WARN: GITHUB_TOKEN is not set. GitHub API limited to 60 req/hr.");
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));

// --- Routes (stubs — filled in phase by phase) ---

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// POST /api/repos — ingest a GitHub repo
app.post("/api/repos", (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented yet" });
});

// GET /api/repos/:id/overview — repo overview
app.get("/api/repos/:id/overview", (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented yet" });
});

// POST /api/repos/:id/query — ask a question about the repo
app.post("/api/repos/:id/query", (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented yet" });
});

// POST /api/repos/:id/change-guide — describe a change, get guidance
app.post("/api/repos/:id/change-guide", (_req: Request, res: Response) => {
  res.status(501).json({ error: "Not implemented yet" });
});

// --- Error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message ?? "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
