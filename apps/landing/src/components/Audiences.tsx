import styles from "./Audiences.module.css";
import { CodeBlock } from "./CodeBlock.tsx";

const BUYER_SNIPPET = `import { MovoClient } from "@movoframework/client";

const client = new MovoClient({
  signer,
  budget: { maxAmountPerRequest: "$0.01", maxTotalSpend: "$1.00" },
});

// Refused over budget -> no signature is ever produced.
const forecast = await client.call(weatherResource, { city: "SFO" }, baseUrl);`;

export function Audiences() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.heading}>
          <span className="eyebrow">Two sides, one protocol</span>
          <h2>Built for the people who ship APIs and the agents that pay for them</h2>
          <p>
            Movo doesn't pick a side. Sellers get a typed resource model and automatic discovery;
            buyers and agents get budget-capped, non-custodial payment with no pre-baked
            integration.
          </p>
        </div>

        <div className={styles.grid}>
          <div className="card">
            <div className={styles.card}>
              <div className={styles.cardTop}>
                <div className={`${styles.icon} ${styles.iconSeller}`} aria-hidden="true">
                  ⇥
                </div>
                <h3>For API builders</h3>
              </div>
              <div className={styles.cardBody}>
                <p>
                  Declare a resource once. Movo compiles it into a route, an x402 declaration, and a
                  Bazaar discovery entry — no separate registration step, no hand-written 402
                  handling.
                </p>
              </div>
              <ul className={styles.list}>
                <li>
                  Typed <code>defineResource</code> / <code>defineApp</code> compiles to a mounted
                  route
                </li>
                <li>
                  Verification and settlement composed from <code>@x402/stellar</code>, never
                  reimplemented
                </li>
                <li>Automatic cataloging at settle time — no separate listing step</li>
                <li>Self-hostable facilitator, standalone or in-process</li>
              </ul>
            </div>
          </div>

          <div className="card">
            <div className={styles.card}>
              <div className={styles.cardTop}>
                <div className={`${styles.icon} ${styles.iconBuyer}`} aria-hidden="true">
                  ⇤
                </div>
                <h3>For agents &amp; buyers</h3>
              </div>
              <div className={styles.cardBody}>
                <p>
                  Find and pay for a resource with no pre-existing integration. Budgets are enforced
                  before a payment is created, so a refusal leaves no signature behind.
                </p>
              </div>
              <CodeBlock label="packages/client — pay with a budget" code={BUYER_SNIPPET} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
