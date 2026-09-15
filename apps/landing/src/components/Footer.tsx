import styles from "./Footer.module.css";

const REPO_URL = "https://github.com/movoframework/movo";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.row}`}>
        <span className={styles.brand}>© {new Date().getFullYear()} Movo · Apache-2.0</span>
        <nav className={styles.links} aria-label="Footer">
          <a href={REPO_URL}>GitHub</a>
          <a href={`${REPO_URL}/blob/main/docs/quickstart.md`}>Quickstart</a>
          <a href={`${REPO_URL}/blob/main/docs/CONFORMANCE.md`}>Conformance</a>
          <a href={`${REPO_URL}/blob/main/SECURITY.md`}>Security</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`}>License</a>
        </nav>
      </div>
    </footer>
  );
}
