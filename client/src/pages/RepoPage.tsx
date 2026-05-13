import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { getOverview } from "../api";
import OverviewTab from "../components/OverviewTab";
import ChatTab from "../components/ChatTab";
import ChangeGuideTab from "../components/ChangeGuideTab";
import styles from "./RepoPage.module.css";

type Panel = "chat" | "guide";

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { metadata, setReady, setError } = useRepoStore();
  const [panel, setPanel] = useState<Panel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);

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
        <p className={styles.loadingText}>Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <button className={styles.back} onClick={() => navigate("/")} title="Back to home">
            ←
          </button>
          <button
            className={styles.sidebarToggle}
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarOpen ? "◁" : "▷"}
          </button>
          <span className={styles.repoSlug}>
            <span className={styles.owner}>{metadata.owner}/</span>{metadata.repo}
          </span>
        </div>
        <div className={styles.panelToggle}>
          <button
            className={`${styles.panelBtn} ${panel === "chat" ? styles.panelActive : ""}`}
            onClick={() => setPanel("chat")}
          >
            Chat
          </button>
          <button
            className={`${styles.panelBtn} ${panel === "guide" ? styles.panelActive : ""}`}
            onClick={() => setPanel("guide")}
          >
            Guide
          </button>
        </div>
      </nav>

      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${sidebarOpen ? "" : styles.sidebarCollapsed}`}>
          <OverviewTab metadata={metadata} />
        </aside>

        <main className={styles.main}>
          {panel === "chat"  && <ChatTab repoId={metadata.id} />}
          {panel === "guide" && <ChangeGuideTab repoId={metadata.id} />}
        </main>
      </div>
    </div>
  );
}
