import { usePulse } from "../hooks/usePulse";
import { timeAgo, fmtNum } from "../utils/format";
import styles from "./PulseTab.module.css";

const HEX6 = /^[0-9a-fA-F]{6}$/;
function safeColor(raw: string): string {
  return HEX6.test(raw) ? raw : "9ca3af";
}

interface Props {
  owner: string;
  repo: string;
}

export default function PulseTab({ owner, repo }: Props) {
  const { repoData, issues, prs, contributors, loading, error } = usePulse(owner, repo);

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
                  {issue.labels.slice(0, 2).map((l) => {
                    const c = safeColor(l.color);
                    return (
                      <span
                        key={l.name}
                        className={styles.label}
                        style={{ background: `#${c}22`, color: `#${c}`, borderColor: `#${c}55` }}
                      >
                        {l.name}
                      </span>
                    );
                  })}
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
              <img src={c.avatar_url} alt={c.login} className={styles.avatar} loading="lazy" width={24} height={24} />
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
