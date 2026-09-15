import styles from "./Features.module.css";

const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Self-hostable facilitator",
    body: "A signer pool, channel accounts, metering and rate limiting over @x402/stellar. Runs standalone or in-process inside a resource server.",
  },
  {
    title: "Bazaar discovery",
    body: "Resources are catalogued automatically when a payment settles. No registration endpoint, no second step.",
  },
  {
    title: "Ranked search",
    body: "BM25 fused with embedding similarity by reciprocal-rank fusion, measured against a labelled evaluation set and gated in CI.",
  },
  {
    title: "MCP tools for agents",
    body: "bazaar.search, bazaar.get and a budget-capped bazaar.paidCall — an agent can find and pay for a resource with no pre-baked integration.",
  },
  {
    title: "Non-custodial by construction",
    body: "The server configuration type admits no payer key. Movo never generates, derives, stores or takes custody of funds.",
  },
  {
    title: "Buyer budgets",
    body: "Per-request and cumulative spend caps, plus payTo and network allowlists, enforced before a payment is created.",
  },
];

export function Features() {
  return (
    <section id="features" className={styles.section}>
      <div className="container">
        <div className={styles.heading}>
          <span className="eyebrow">What ships today</span>
          <h2>Every item below is implemented and tested</h2>
          <p>Not a roadmap. Read docs/CONFORMANCE.md for the evidence behind each one.</p>
        </div>

        <div className={styles.grid}>
          {FEATURES.map((feature) => (
            <div key={feature.title} className={`card ${styles.feature}`}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
