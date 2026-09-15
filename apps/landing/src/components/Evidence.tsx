import { CONFORMANCE_URL } from "../repo.ts";

const SETTLED_HASH = "a3433b2562af4adf8f0bb40ccbe4eff6618fd20145c9c36fd59533e094471845";
const HORIZON_URL = `https://horizon-testnet.stellar.org/transactions/${SETTLED_HASH}`;

const STATS: readonly { value: string; label: string }[] = [
  { value: "7/7", label: "Stock-client conformance, passing" },
  { value: "0.9332", label: "nDCG@10, hybrid Bazaar search" },
  { value: "1.0000", label: "Recall@20, hybrid Bazaar search" },
];

export function Evidence() {
  return (
    <section id="evidence" className="evidence gutter">
      <div className="evidence-heading">Not a claim — an artefact</div>
      <h2 className="evidence-title">
        Every number here
        <br />
        has a hash behind it.
      </h2>

      <div className="evidence-stats">
        {STATS.map((stat) => (
          <div key={stat.label} className="evidence-stat">
            <div className="evidence-stat-value">{stat.value}</div>
            <div className="evidence-stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="evidence-hash">
        <div className="evidence-hash-text">
          <span className="evidence-hash-label">Latest settlement — stellar:testnet · exact</span>
          <span className="evidence-hash-value">{SETTLED_HASH}</span>
        </div>
        <a className="evidence-hash-link" href={HORIZON_URL}>
          Verify on Horizon →
        </a>
      </div>

      <a className="evidence-footnote" href={CONFORMANCE_URL}>
        Full evidence trail in docs/CONFORMANCE.md →
      </a>
    </section>
  );
}
