import styles from "./Evidence.module.css";

const STATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "7 / 7", label: "x402's own e2e suite, passing against the Movo facilitator" },
  { value: "0.9332", label: "nDCG@10, hybrid Bazaar search (floor 0.70)" },
  { value: "1.0000", label: "recall@20, hybrid Bazaar search (floor 0.90)" },
  { value: "92.18%", label: "@movoframework/core line coverage (floor 90%)" },
];

const SETTLED_HASH = "a3433b2562af4adf8f0bb40ccbe4eff6618fd20145c9c36fd59533e094471845";

export function Evidence() {
  return (
    <section id="evidence" className={styles.section}>
      <div className="container">
        <div className={styles.heading}>
          <span className="eyebrow">Not a claim — an artefact</span>
          <h2>Every number here has a transaction hash or a test behind it</h2>
          <p>
            Movo's conformance page never asserts on a header alone. Every settlement is confirmed
            independently from Horizon — a source that is neither the server under test nor the
            facilitator that reported it.
          </p>
        </div>

        <div className={styles.grid}>
          {STATS.map((stat) => (
            <div key={stat.label} className={`card ${styles.stat}`}>
              <div className={styles.statValue}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div className={`card ${styles.hashRow}`}>
          <div className={styles.hashLeft}>
            <span className={styles.hashLabel}>
              Latest stock-client settlement — stellar:testnet · exact
            </span>
            <span className={styles.hashValue}>{SETTLED_HASH}</span>
          </div>
          <a
            className="button button-secondary"
            href={`https://horizon-testnet.stellar.org/transactions/${SETTLED_HASH}`}
          >
            Verify on Horizon ↗
          </a>
        </div>

        <p className={styles.footnote}>
          Movo is <strong>testnet-complete</strong>, not production-ready: pubnet settlement and a
          third-party security review are the committed next milestone, not oversights. See{" "}
          <a href="https://github.com/movoframework/movo/blob/main/docs/CONFORMANCE.md">
            docs/CONFORMANCE.md
          </a>{" "}
          for the full evidence trail.
        </p>
      </div>
    </section>
  );
}
