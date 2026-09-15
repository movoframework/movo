import styles from "./HowItWorks.module.css";

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Request",
    body: "An agent calls your endpoint with no payment attached.",
  },
  {
    title: "402",
    body: "Movo returns a standard x402 402 naming the price and accepted assets.",
  },
  {
    title: "Settle",
    body: "The buyer signs, the facilitator verifies and settles on Stellar — confirmed on-chain, not just reported.",
  },
  {
    title: "Discover",
    body: "The paid resource is catalogued automatically, searchable by the next agent that needs it.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className={styles.section}>
      <div className="container">
        <div className={styles.heading}>
          <span className="eyebrow">The payment lifecycle</span>
          <h2>Four steps, and Movo owns none of the hard parts</h2>
          <p>
            Verification and settlement are <code>@x402/stellar</code>, unmodified. Movo composes
            the flow and asserts the invariants — it doesn't reimplement the protocol.
          </p>
        </div>

        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
