import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { useRecentRepos } from "../store/useRecentRepos";
import { ingestRepoStream } from "../api";
import { useIngestionProgress, type IngestionStage } from "../hooks/useIngestionProgress";
import ThemeToggle from "../components/ThemeToggle";
import { EXAMPLES } from "../constants";
import Footer from "../components/Footer";
import styles from "./LandingPage.module.css";

const STEPS: {
  id: IngestionStage;
  icon: string;
  label: string;
  tech: string;
  tooltip: { title: string; body: string };
}[] = [
  {
    id: "fetch", icon: "↓", label: "Fetch", tech: "Zip",
    tooltip: { title: "Fetch", body: "Downloads the repo as a single zip from GitHub. One HTTP call, all files at once." },
  },
  {
    id: "chunk", icon: "⚙", label: "Parse", tech: "Babel AST",
    tooltip: { title: "AST", body: "Babel turns your code into a syntax tree. We split by real boundaries — functions, components, hooks, classes — not arbitrary line counts." },
  },
  {
    id: "embed", icon: "✦", label: "Embed", tech: "BGE-small 384d",
    tooltip: { title: "Embeddings", body: "Each chunk becomes 384 numbers that capture its meaning. Similar code = similar vectors." },
  },
  {
    id: "done", icon: "◎", label: "Chat", tech: "RAG · Gemini",
    tooltip: { title: "RAG", body: "Your question is embedded the same way. The top matching chunks go to Gemini — not the whole codebase. That's retrieval-augmented generation." },
  },
];

const STAGE_ORDER: IngestionStage[] = ["idle", "fetch", "chunk", "embed", "done"];

function stepClassName(stepId: IngestionStage, stage: IngestionStage, styles: Record<string, string>): string {
  if (stage === "idle") return styles.stepIdle;
  const stepIdx = STAGE_ORDER.indexOf(stepId);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  if (stepIdx === stageIdx) return styles.stepActive;   // currently working — pulses
  if (stepIdx < stageIdx) return styles.stepVisible;    // completed
  return styles.stepDim;                                  // upcoming
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { setIngesting, setReady, setError, setChunkWarning, cancelIngest, status, error } = useRepoStore();
  const { recents, addRecent } = useRecentRepos();
  const [url, setUrl] = useState("");
  const isLoading = status === "ingesting";
  const { percent, stage, onProgress, onDone, reset } = useIngestionProgress();
  const cleanupRef = useRef<(() => void) | null>(null);

  function handleCancel() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    cancelIngest();
    reset();
  }

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!url.trim() || isLoading) return;
    setIngesting();
    reset();

    cleanupRef.current = ingestRepoStream(
      url.trim(),
      onProgress,
      (repoId, metadata) => {
        onDone();
        setReady(repoId, metadata);
        addRecent({ owner: metadata.owner, repo: metadata.repo, url: url.trim() });
        setTimeout(() => navigate(`/repo/${repoId}`), 300);
      },
      (err) => setError(err),
      (msg) => setChunkWarning(msg),
    );
  }

  return (
    <div className={styles.page}>
      <a
        className={styles.repoBtn}
        href="https://github.com/rajatetc/repo-grok"
        target="_blank"
        rel="noreferrer"
        title="View source on GitHub"
        aria-label="View source on GitHub"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
        </svg>
      </a>
      <ThemeToggle className={styles.themeBtn} />

      <div className={styles.hero}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>&lt;/&gt;</span>
          <span className={styles.logoText}>RepoGrok</span>
        </div>

        <p className={styles.tagline}>
          Understand any JavaScript or TypeScript codebase in minutes.<br />
          Paste a GitHub URL and start exploring.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="text"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
            spellCheck={false}
          />
          <button
            className={`${styles.button} ${isLoading ? styles.buttonMuted : ""}`}
            type="button"
            onClick={isLoading ? handleCancel : () => handleSubmit()}
            title={isLoading ? "Cancel" : "Explore"}
          >
            {isLoading ? "Cancel" : "Explore →"}
          </button>
        </form>

        {percent > 0 && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        )}


        <div className={styles.pipeline}>
          {STEPS.map((step, i) => (
            <div key={step.id} className={styles.pipelineItem}>
              <div className={`${styles.step} ${stepClassName(step.id, stage, styles)}`}>
                <span className={styles.stepIcon}>{step.icon}</span>
                <span className={styles.stepText}>
                  <span className={styles.stepLabel}>{step.label}</span>
                  <span className={styles.stepTech}>{step.tech}</span>
                </span>
                <span className={styles.tooltip}>
                  <span className={styles.tooltipTitle}>{step.tooltip.title}</span>
                  {step.tooltip.body}
                </span>
              </div>
              {i < STEPS.length - 1 && <span className={styles.stepArrow}>→</span>}
            </div>
          ))}
        </div>
        {status === "error" && error && <p className={styles.errorMsg}>{error}</p>}
      </div>

      <div className={styles.examples}>
        <p className={styles.examplesLabel}>Try these repos</p>
        <div className={styles.chips}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.repo}
              className={styles.chip}
              disabled={isLoading}
              onClick={() => setUrl(`https://github.com/${ex.owner}/${ex.repo}`)}
            >
              <span className={styles.chipIcon}>&lt;/&gt;</span>
              {ex.repo}
            </button>
          ))}
        </div>
      </div>

      {recents.length > 0 && (
        <div className={styles.examples}>
          <p className={styles.examplesLabel}>Recently explored</p>
          <div className={styles.chips}>
            {recents.map((r) => (
              <button
                key={r.url}
                className={styles.chip}
                disabled={isLoading}
                onClick={() => setUrl(r.url)}
              >
                {r.owner}/{r.repo}
              </button>
            ))}
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
