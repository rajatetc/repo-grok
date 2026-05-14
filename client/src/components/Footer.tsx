import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <span>
        Built by{" "}
        <a href="https://rajatgupta.site/" target="_blank" rel="noreferrer">
          Rajat Gupta
        </a>
      </span>
      <span className={styles.footerDot}>·</span>
      <a href="https://github.com/rajatetc" target="_blank" rel="noreferrer">
        GitHub
      </a>
      <span className={styles.footerDot}>·</span>
      <a
        href="https://linkedin.com/in/rajatetc"
        target="_blank"
        rel="noreferrer"
      >
        LinkedIn
      </a>
      <span className={styles.footerDot}>·</span>
      <a href="https://x.com/rajatetc" target="_blank" rel="noreferrer">
        X
      </a>
    </footer>
  );
}
