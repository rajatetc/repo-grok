import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { getOverview } from "../api";
import OverviewTab from "../components/OverviewTab";
import ChatTab from "../components/ChatTab";
import ChangeGuideTab from "../components/ChangeGuideTab";
import styles from "./RepoPage.module.css";

type Tab = "overview" | "chat" | "change-guide";

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { metadata, setReady, setError } = useRepoStore();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);

  // If page was refreshed or linked directly, re-fetch metadata
  useEffect(() => {
    if (!id) return;
    if (metadata?.id === id) return;
    setLoading(true);
    getOverview(id)
      .then((data) => setReady(id, data))
      .catch(() => {
        setError("Repo not found. It may have expired.");
        navigate("/");
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !metadata) {
    return (
      <div className={styles.center}>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/")}>← Back</button>
        <div>
          <h1 className={styles.repoName}>
            {metadata.owner}/<span>{metadata.repo}</span>
          </h1>
          <p className={styles.meta}>
            {metadata.fileCount} files · {metadata.totalChunks} chunks · branch: {metadata.branch}
          </p>
        </div>
      </header>

      <nav className={styles.tabs}>
        {(["overview", "chat", "change-guide"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.active : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "overview" ? "Overview" : t === "chat" ? "Chat" : "Change Guide"}
          </button>
        ))}
      </nav>

      <main className={styles.content}>
        {tab === "overview"     && <OverviewTab metadata={metadata} />}
        {tab === "chat"         && <ChatTab repoId={metadata.id} />}
        {tab === "change-guide" && <ChangeGuideTab repoId={metadata.id} />}
      </main>
    </div>
  );
}
