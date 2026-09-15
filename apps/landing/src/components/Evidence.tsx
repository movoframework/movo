import type { CSSProperties } from "react";
import { CONFORMANCE_URL } from "../repo.ts";
import { useReveal } from "../useReveal.ts";

const SETTLED_HASH = "a3433b2562af4adf8f0bb40ccbe4eff6618fd20145c9c36fd59533e094471845";
const HORIZON_URL = `https://horizon-testnet.stellar.org/transactions/${SETTLED_HASH}`;

interface Stat {
  readonly value: string;
  readonly label: string;
}

const STATS: readonly Stat[] = [
  { value: "7/7", label: "Stock-client conformance, passing" },
  { value: "0.9332", label: "nDCG@10, hybrid Bazaar search" },
  { value: "1.0000", label: "Recall@20, hybrid Bazaar search" },
];

function StatItem({ stat, delay }: { stat: Stat; delay: number }) {
  const { ref, className } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`evidence-stat ${className}`}
      style={{ "--reveal-delay": `${delay}s` } as CSSProperties}
    >
      <div className="evidence-stat-value">{stat.value}</div>
      <div className="evidence-stat-label">{stat.label}</div>
    </div>
  );
}

export function Evidence() {
  const hash = useReveal<HTMLDivElement>();

  return (
    <section id="evidence" className="evidence gutter">
      <div className="evidence-heading">Not a claim — an artefact</div>
      <h2 className="evidence-title">
        Every number here
        <br />
        has a hash behind it.
      </h2>

      <div className="evidence-stats">
        {STATS.map((stat, i) => (
          <StatItem key={stat.label} stat={stat} delay={i * 0.1} />
        ))}
      </div>

      <div ref={hash.ref} className={`evidence-hash ${hash.className}`}>
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
