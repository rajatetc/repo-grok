import { useState, useEffect } from "react";
import styles from "./PulseTab.module.css";

interface GHRepo {
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
}

interface GHIssue {
  id: number;
  title: string;
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  created_at: string;
  pull_request?: unknown;
}

interface GHContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

interface Props {
  owner: string;
  repo: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export default function PulseTab({ owner, repo }: Props) {
  const [repoData, setRepoData]       = useState<GHRepo | null>(null);
  const [issues, setIssues]           = useState<GHIssue[]>([]);
  const [prs, setPrs]                 = useState<GHIssue[]>([]);
  const [contributors, setContribs]   = useState<GHContributor[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const h = { Accept: "application/vnd.github+json" };

    Promise.all([
      fetch(base, { headers: h }).then((r) => r.json()),
      fetch(`${base}/issues?state=open&per_page=5&sort=created&direction=desc`, { headers: h }).then((r) => r.json()),
      fetch(`${base}/pulls?state=open&per_page=5&sort=created&direction=desc`, { headers: h }).then((r) => r.json()),
      fetch(`${base}/contributors?per_page=5`, { headers: h }).then((r) => r.json()),
    ])
      .then(([rd, iss, pullList, contrib]) => {
        setRepoData(rd as GHRepo);
        setIssues((iss as GHIssue[]).filter((i) => !i.pull_request));
        setPrs(pullList as GHIssue[]);
        setContribs(contrib as GHContributor[]);
      })
      .catch(() => setError("Failed to load GitHub data. You may have hit the rate limit."))
      .finally(() => setLoading(false));
  }, [owner, repo]);

  if (loading) {
    return <div className={styles.center}><span className={styles.muted}>Loading…</span></div>;
  }
  if (error || !repoData) {
    return <div className={styles.center}><span className={styles.muted}>{error ?? "No data"}</span></div>;
  }

  return (
    <div className={styles.container}>

      {/* ── Stats ── */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statVal}>★ {fmtNum(repoData.stargazers_count)}</span>
          <span className={styles.statLbl}>Stars</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{fmtNum(repoData.forks_count)}</span>
          <span className={styles.statLbl}>Forks</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{timeAgo(repoData.pushed_at)}</span>
          <span className={styles.statLbl}>Last push</span>
        </div>
      </div>

      {/* ── Issues ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <a href={`https://github.com/${owner}/${repo}/issues`} target="_blank" rel="noreferrer" className={styles.sectionTitle}>Open Issues</a>
          {issues.length > 0 && (
            <span className={styles.pill}>{issues.length}{issues.length === 5 ? "+" : ""}</span>
          )}
        </div>
        {issues.length === 0 ? (
          <p className={styles.empty}>No open issues</p>
        ) : (
          <ul className={styles.list}>
            {issues.map((issue) => (
              <li key={issue.id} className={styles.item}>
                <a href={issue.html_url} target="_blank" rel="noreferrer" className={styles.itemTitle}>
                  {issue.title}
                </a>
                <div className={styles.itemMeta}>
                  {issue.labels.slice(0, 2).map((l) => (
                    <span
                      key={l.name}
                      className={styles.label}
                      style={{ background: `#${l.color}22`, color: `#${l.color}`, borderColor: `#${l.color}55` }}
                    >
                      {l.name}
                    </span>
                  ))}
                  <span className={styles.time}>{timeAgo(issue.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── PRs ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <a href={`https://github.com/${owner}/${repo}/pulls`} target="_blank" rel="noreferrer" className={styles.sectionTitle}>Open PRs</a>
          {prs.length > 0 && (
            <span className={styles.pill}>{prs.length}{prs.length === 5 ? "+" : ""}</span>
          )}
        </div>
        {prs.length === 0 ? (
          <p className={styles.empty}>No open pull requests</p>
        ) : (
          <ul className={styles.list}>
            {prs.map((pr) => (
              <li key={pr.id} className={styles.item}>
                <a href={pr.html_url} target="_blank" rel="noreferrer" className={styles.itemTitle}>
                  {pr.title}
                </a>
                <span className={styles.time}>{timeAgo(pr.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Contributors ── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Top Contributors</span>
        </div>
        <ul className={styles.contributors}>
          {contributors.map((c) => (
            <li key={c.login} className={styles.contributor}>
              <img src={c.avatar_url} alt={c.login} className={styles.avatar} />
              <a href={c.html_url} target="_blank" rel="noreferrer" className={styles.contributorName}>
                {c.login}
              </a>
              <span className={styles.commits}>{c.contributions.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}
