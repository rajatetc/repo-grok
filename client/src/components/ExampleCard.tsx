import styles from "./ExampleCard.module.css";

interface Props {
  owner: string;
  repo: string;
  desc: string;
  time: string;
  disabled: boolean;
  onClick: () => void;
}

export default function ExampleCard({ owner, repo, desc, time, disabled, onClick }: Props) {
  return (
    <button className={styles.card} onClick={onClick} disabled={disabled}>
      <div className={styles.name}>
        <span className={styles.owner}>{owner}/</span>
        <span className={styles.repo}>{repo}</span>
      </div>
      <p className={styles.desc}>{desc}</p>
      <span className={styles.time}>{time}</span>
    </button>
  );
}
