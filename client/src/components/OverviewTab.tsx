import { useState } from "react";
import type { RepoMetadata, FolderNode, TechStack } from "../types";
import styles from "./OverviewTab.module.css";

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
}

function TreeNode({ node, depth, openPaths, toggle }: TreeNodeProps) {
  const indent = { paddingLeft: depth * 12 };

  if (node.type === "file") {
    return (
      <div className={styles.file} style={indent}>
        <span className={styles.fileIcon}>·</span> {node.name}
      </div>
    );
  }

  const isOpen = openPaths.has(node.path);
  return (
    <div>
      {depth > 0 && (
        <div className={styles.dir} style={indent} onClick={() => toggle(node.path)}>
          <span className={styles.dirIcon}>{isOpen ? "▾" : "▸"}</span> {node.name}/
        </div>
      )}
      {(isOpen || depth === 0) &&
        node.children?.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} openPaths={openPaths} toggle={toggle} />
        ))}
    </div>
  );
}

function getTopLevelPaths(node: FolderNode): Set<string> {
  const paths = new Set<string>();
  if (node.type === "directory" && node.children) {
    for (const child of node.children) {
      if (child.type === "directory") paths.add(child.path);
    }
  }
  return paths;
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { metadata: RepoMetadata }

export default function OverviewTab({ metadata }: Props) {
  const { techStack, folderTree, fileCount, branch } = metadata;
  const techGroups = groupTech(techStack);
  const hasTech = Object.keys(techGroups).length > 0;
  const [openPaths, setOpenPaths] = useState(() => getTopLevelPaths(folderTree));

  function toggle(path: string) {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

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
      </div>

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
        <p className={styles.treeLabel}>Structure</p>
        <div className={styles.tree}>
          <TreeNode node={folderTree} depth={0} openPaths={openPaths} toggle={toggle} />
        </div>
      </div>
    </div>
  );
}
