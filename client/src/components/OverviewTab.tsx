import { useEffect, useState } from "react";
import type { RepoMetadata, FolderNode, TechStack } from "../types";
import styles from "./OverviewTab.module.css";

function topLevelDirPaths(tree: FolderNode): Set<string> {
  const paths = new Set<string>();
  for (const child of tree.children ?? []) {
    if (child.type === "directory") paths.add(child.path);
  }
  return paths;
}

// ── Tech badges ──────────────────────────────────────────────────────────────

type BadgeCategory = "framework" | "build" | "state" | "test" | "style" | "backend" | "other";

const CATEGORY_LABELS: Record<BadgeCategory, string> = {
  framework: "Framework",
  build:     "Build",
  state:     "State",
  test:      "Testing",
  style:     "Styling",
  backend:   "Backend",
  other:     "Other",
};

function TechBadge({ label, category }: { label: string; category: BadgeCategory }) {
  return <span className={`${styles.badge} ${styles[`badge_${category}`]}`}>{label}</span>;
}

function groupTech(ts: TechStack): Partial<Record<BadgeCategory, string[]>> {
  const groups: Partial<Record<BadgeCategory, string[]>> = {};
  function add(cat: BadgeCategory, val: string | undefined | string[]) {
    if (!val) return;
    const items = Array.isArray(val) ? val : [val];
    if (items.length) groups[cat] = [...(groups[cat] ?? []), ...items];
  }
  add("framework", ts.framework);
  add("build",     ts.buildTool);
  add("state",     ts.stateManagement);
  add("test",      ts.testing);
  add("style",     ts.styling);
  add("backend",   ts.backend);
  add("other",     ts.other);
  return groups;
}

// ── Folder tree (collapsible) ─────────────────────────────────────────────────

interface TreeNodeProps {
  node: FolderNode;
  depth: number;
  openPaths: Set<string>;
  toggle: (path: string) => void;
  baseUrl: string;
  branch: string;
}

function TreeNode({ node, depth, openPaths, toggle, baseUrl, branch }: TreeNodeProps) {
  const indent = { paddingLeft: depth * 12 };

  if (node.type === "file") {
    return (
      <div className={styles.file} style={indent}>
        <span className={styles.fileIcon}>·</span>{" "}
        <a href={`${baseUrl}/blob/${branch}/${node.path}`} target="_blank" rel="noreferrer" className={styles.fileLink}>
          {node.name}
        </a>
      </div>
    );
  }

  const isOpen = openPaths.has(node.path);
  return (
    <div>
      {depth > 0 && (
        <div className={styles.dir} style={indent} onClick={() => toggle(node.path)}>
          <span className={styles.dirIcon}>{isOpen ? "▾" : "▸"}</span>{" "}
          <a href={`${baseUrl}/tree/${branch}/${node.path}`} target="_blank" rel="noreferrer" className={styles.fileLink}
             onClick={(e) => e.stopPropagation()}>
            {node.name}/
          </a>
        </div>
      )}
      {(isOpen || depth === 0) &&
        node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} openPaths={openPaths} toggle={toggle} baseUrl={baseUrl} branch={branch} />
        ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { metadata: RepoMetadata }

export default function OverviewTab({ metadata }: Props) {
  const { techStack, folderTree, fileCount, branch, owner, repo } = metadata;
  const baseUrl = `https://github.com/${owner}/${repo}`;
  const techGroups = groupTech(techStack);
  const hasTech = Object.keys(techGroups).length > 0;
  const [openPaths, setOpenPaths] = useState(() => topLevelDirPaths(folderTree));

  // Reset to top-level-open when navigating to a different repo.
  useEffect(() => {
    setOpenPaths(topLevelDirPaths(folderTree));
  }, [folderTree]);

  function toggle(path: string) {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const { linesOfCode, dependencyCount, devDependencyCount, chunkBreakdown } = metadata;
  const [structureOpen, setStructureOpen] = useState(true);

  const codeUnits = chunkBreakdown
    ? [
        chunkBreakdown.component && `${chunkBreakdown.component} components`,
        chunkBreakdown.hook       && `${chunkBreakdown.hook} hooks`,
        chunkBreakdown.function   && `${chunkBreakdown.function} functions`,
        chunkBreakdown.class      && `${chunkBreakdown.class} classes`,
      ].filter(Boolean)
    : [];

  return (
    <div className={styles.container}>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statVal}>{fileCount}</span>
          <span className={styles.statLbl}>files</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statVal}>{branch}</span>
          <span className={styles.statLbl}>branch</span>
        </div>
        {linesOfCode != null && (
          <div className={styles.stat}>
            <span className={styles.statVal}>{linesOfCode.toLocaleString()}</span>
            <span className={styles.statLbl}>lines of code</span>
          </div>
        )}
        {dependencyCount != null && (
          <div className={styles.stat}>
            <span className={styles.statVal}>{dependencyCount}</span>
            <span className={styles.statLbl}>dependencies</span>
          </div>
        )}
        {devDependencyCount != null && (
          <div className={styles.stat}>
            <span className={styles.statVal}>{devDependencyCount}</span>
            <span className={styles.statLbl}>dev deps</span>
          </div>
        )}
      </div>

      {codeUnits.length > 0 && (
        <div className={styles.breakdown}>
          {codeUnits.map((u) => (
            <span key={u as string} className={styles.breakdownPill}>{u}</span>
          ))}
        </div>
      )}

      {hasTech && (
        <div className={styles.techSection}>
          {(Object.keys(techGroups) as BadgeCategory[]).map((cat) => (
            <div key={cat} className={styles.badgeGroup}>
              <span className={styles.badgeGroupLabel}>{CATEGORY_LABELS[cat]}</span>
              <div className={styles.badges}>
                {techGroups[cat]!.map((label) => (
                  <TechBadge key={label} label={label} category={cat} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.treeSection}>
        <button className={styles.treeToggle} onClick={() => setStructureOpen((v) => !v)}>
          <span className={styles.treeLabel}>Structure</span>
          <span className={styles.treeChevron}>{structureOpen ? "▾" : "▸"}</span>
        </button>
        {structureOpen && (
          <div className={styles.tree}>
            <TreeNode node={folderTree} depth={0} openPaths={openPaths} toggle={toggle} baseUrl={baseUrl} branch={branch} />
          </div>
        )}
      </div>
    </div>
  );
}
