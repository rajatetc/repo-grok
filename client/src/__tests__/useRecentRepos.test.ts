import { describe, it, expect, beforeEach } from "vitest";
import { useRecentRepos } from "../store/useRecentRepos";

const STORAGE_KEY = "repogrok-recent";

function reset() {
  localStorage.clear();
  // The store was hydrated from localStorage at module load — reset its in-memory copy too.
  useRecentRepos.setState({ recents: [] });
}

function addRedux()   { useRecentRepos.getState().addRecent({ owner: "reduxjs",   repo: "redux",   url: "https://github.com/reduxjs/redux" }); }
function addExpress() { useRecentRepos.getState().addRecent({ owner: "expressjs", repo: "express", url: "https://github.com/expressjs/express" }); }
function addAxios()   { useRecentRepos.getState().addRecent({ owner: "axios",     repo: "axios",   url: "https://github.com/axios/axios" }); }

describe("useRecentRepos", () => {
  beforeEach(reset);

  it("adds a new repo to the front of the list", () => {
    addRedux();
    const { recents } = useRecentRepos.getState();
    expect(recents).toHaveLength(1);
    expect(recents[0].repo).toBe("redux");
  });

  it("dedupes by URL when re-adding", () => {
    addRedux();
    addExpress();
    addRedux(); // re-add — should move to front, not duplicate
    const { recents } = useRecentRepos.getState();
    expect(recents).toHaveLength(2);
    expect(recents.map((r) => r.repo)).toEqual(["redux", "express"]);
  });

  it("caps the list at MAX_RECENT (5)", () => {
    for (let i = 0; i < 7; i++) {
      useRecentRepos.getState().addRecent({
        owner: "owner",
        repo: `repo-${i}`,
        url: `https://github.com/owner/repo-${i}`,
      });
    }
    const { recents } = useRecentRepos.getState();
    expect(recents).toHaveLength(5);
    // Most recent first: repo-6, repo-5, repo-4, repo-3, repo-2
    expect(recents[0].repo).toBe("repo-6");
    expect(recents[4].repo).toBe("repo-2");
  });

  it("persists to localStorage on add", () => {
    addAxios();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].repo).toBe("axios");
  });
});
