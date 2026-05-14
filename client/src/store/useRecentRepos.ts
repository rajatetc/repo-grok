import { create } from "zustand";

const STORAGE_KEY = "repogrok-recent";
const MAX_RECENT = 5;

export interface RecentRepo {
  repoId: string;
  owner: string;
  repo: string;
  url: string;
}

interface RecentReposStore {
  recents: RecentRepo[];
  addRecent: (entry: RecentRepo) => void;
}

function loadFromStorage(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export const useRecentRepos = create<RecentReposStore>((set) => ({
  recents: loadFromStorage(),

  addRecent: (entry) =>
    set((state) => {
      const filtered = state.recents.filter((r) => r.url !== entry.url);
      const updated = [entry, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return { recents: updated };
    }),
}));
