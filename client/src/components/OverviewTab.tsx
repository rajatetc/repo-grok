import type { RepoMetadata, FolderNode } from "../types";
import styles from "./OverviewTab.module.css";

function TechBadge({ label }: { label: string }) {
  return <span className={styles.badge}>{label}</span>;
}

function FolderTree({ node, depth = 0 }: { node: FolderNode; depth?: number }) {
  if (node.type === "file") {
    return (
      <div className={styles.file} style={{ paddingLeft: depth * 16 }}>
        <span className={styles.fileIcon}>·</span> {node.name}
      </div>
    );
  }
  return (
    <div>
      {depth > 0 && (
        <div className={styles.dir} style={{ paddingLeft: depth * 16 }}>
          <span className={styles.dirIcon}>▸</span> {node.name}/
        </div>
      )}
      {node.children?.map((child) => (
        <FolderTree key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

interface Props { metadata: RepoMetadata }

export default function OverviewTab({ metadata }: Props) {
  const { techStack, folderTree } = metadata;
  const hasTech = Object.keys(techStack).length > 0;

  const allTech = [
    techStack.framework,
    techStack.buildTool,
    ...(techStack.backend ?? []),
    ...(techStack.stateManagement ?? []),
    ...(techStack.styling ?? []),
    ...(techStack.testing ?? []),
    ...(techStack.other ?? []),
  ].filter(Boolean) as string[];

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Tech Stack</h2>
        {hasTech ? (
          <div className={styles.badges}>
            {allTech.map((t) => <TechBadge key={t} label={t} />)}
          </div>
        ) : (
          <p className={styles.empty}>No package.json detected or pure TypeScript library.</p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>File Structure</h2>
        <div className={styles.tree}>
          <FolderTree node={folderTree} />
        </div>
      </section>
    </div>
  );
}
