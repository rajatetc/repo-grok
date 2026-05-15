import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { API_BASE } from "../constants";
import ThemeToggle from "../components/ThemeToggle";
import OverviewTab from "../components/OverviewTab";
import PulseTab from "../components/PulseTab";
import ChatTab from "../components/ChatTab";
import Footer from "../components/Footer";
import styles from "./RepoPage.module.css";

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { metadata, setReady, chunkWarning, setChunkWarning } = useRepoStore();
  const [activeTab, setActiveTab] = useState<"overview" | "pulse">("overview");
  // Pulse fires 4 GitHub API calls per repo open. Defer the mount until the
  // user actually clicks the tab, then keep it mounted so the fetched data
  // survives tab toggles for the rest of the session.
  const [pulseEverOpened, setPulseEverOpened] = useState(false);
  const loading = !metadata || metadata.id !== id;

  useEffect(() => {
    if (!id) { navigate("/", { replace: true }); return; }
    if (metadata && metadata.id === id) return;

    fetch(`${API_BASE}/api/repos/${id}/overview`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setReady(id, data))
      .catch(() => navigate("/", { replace: true }));
  }, [id, metadata, navigate, setReady]);

  if (loading || !metadata) return (
    <div className={styles.loadingState}>
      Loading…
    </div>
  );

  return (
    <div className={styles.page}>

      {/* ── Nav ─────────────────────────────── */}
      <nav className={styles.nav}>
        <div className={styles.navLeft}>
          <button className={styles.iconBtn} onClick={() => navigate("/")} title="Back">←</button>
          <span className={styles.repoSlug}>
            <span className={styles.owner}>{metadata.owner}/</span>{metadata.repo}
          </span>
        </div>
        <div className={styles.navRight}>
          <ThemeToggle className={styles.iconBtn} />
        </div>
      </nav>

      {chunkWarning && (
        <div className={styles.warningBanner}>
          <span>{chunkWarning}</span>
          <button
            className={styles.warningDismiss}
            onClick={() => setChunkWarning(null)}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {/* ── Body ────────────────────────────── */}
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTabs}>
            <button
              className={`${styles.sidebarTab} ${activeTab === "overview" ? styles.sidebarTabActive : ""}`}
              onClick={() => setActiveTab("overview")}
            >Overview</button>
            <button
              className={`${styles.sidebarTab} ${activeTab === "pulse" ? styles.sidebarTabActive : ""}`}
              onClick={() => { setActiveTab("pulse"); setPulseEverOpened(true); }}
            >Pulse</button>
          </div>
          <div className={styles.sidebarContent}>
            <div hidden={activeTab !== "overview"}><OverviewTab metadata={metadata} /></div>
            {pulseEverOpened && (
              <div hidden={activeTab !== "pulse"}><PulseTab owner={metadata.owner} repo={metadata.repo} /></div>
            )}
          </div>
        </aside>
        <main className={styles.chatArea}>
          <ChatTab repoId={metadata.id} />
        </main>
      </div>

      <Footer />
    </div>
  );
}
