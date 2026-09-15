import styles from "./CallToAction.module.css";

const REPO_URL = "https://github.com/movoframework/movo";

export function CallToAction() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={`card ${styles.card}`}>
          <h2>Clone it, run it, settle a payment on testnet today</h2>
          <p>
            Not yet on npm — v0.1.0 is testnet-complete and runs from a checkout while the first
            publish is prepared. The full quickstart takes under an hour.
          </p>
          <div className={styles.ctas}>
            <a className="button button-primary" href={REPO_URL}>
              View on GitHub
            </a>
            <a
              className="button button-secondary"
              href={`${REPO_URL}/blob/main/docs/quickstart.md`}
            >
              Read the quickstart
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
