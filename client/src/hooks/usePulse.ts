import { useState, useEffect } from "react";

export interface GHRepo {
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
}

export interface GHIssue {
  id: number;
  title: string;
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  created_at: string;
  pull_request?: unknown;
}

export interface GHContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

interface UsePulseResult {
  repoData: GHRepo | null;
  issues: GHIssue[];
  prs: GHIssue[];
  contributors: GHContributor[];
  loading: boolean;
  error: string | null;
}

export function usePulse(owner: string, repo: string): UsePulseResult {
  const [repoData, setRepoData]       = useState<GHRepo | null>(null);
  const [issues, setIssues]           = useState<GHIssue[]>([]);
  const [prs, setPrs]                 = useState<GHIssue[]>([]);
  const [contributors, setContribs]   = useState<GHContributor[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const h = { Accept: "application/vnd.github+json" };
    const signal = AbortSignal.timeout(10_000);

    Promise.all([
      fetch(base, { headers: h, signal }).then((r) => r.json()),
      fetch(`${base}/issues?state=open&per_page=5&sort=created&direction=desc`, { headers: h, signal }).then((r) => r.json()),
      fetch(`${base}/pulls?state=open&per_page=5&sort=created&direction=desc`, { headers: h, signal }).then((r) => r.json()),
      fetch(`${base}/contributors?per_page=5`, { headers: h, signal }).then((r) => r.json()),
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

  return { repoData, issues, prs, contributors, loading, error };
}
