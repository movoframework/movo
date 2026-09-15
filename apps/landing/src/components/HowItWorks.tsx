import type { CSSProperties } from "react";
import { useReveal } from "../useReveal.ts";

interface Step {
  readonly index: string;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly Step[] = [
  { index: "01", title: "Request", body: "An agent calls your endpoint with no payment attached." },
  {
    index: "02",
    title: "402",
    body: "A standard x402 402 comes back, naming the price and accepted assets.",
  },
  {
    index: "03",
    title: "Settle",
    body: "The buyer signs, the facilitator verifies and settles on Stellar — confirmed on-chain.",
  },
  {
    index: "04",
    title: "Discover",
    body: "The paid resource is catalogued automatically, searchable by the next agent.",
  },
];

const SNIPPET = `import { defineResource, defineApp } from "@movoframework/core";
import { mountExpress } from "@movoframework/server";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  handler: (ctx) => ({ city: ctx.params.city, tempC: 14 }),
});

await mountExpress(app, defineApp({ resources: [weather] }));`;

function StepItem({ step, delay }: { step: Step; delay: number }) {
  const { ref, className } = useReveal<HTMLLIElement>();

  return (
    <li
      ref={ref}
      className={`mechanism-step ${className}`}
      style={{ "--reveal-delay": `${delay}s` } as CSSProperties}
    >
      <span className="mechanism-step-index">{step.index}</span>
      <div className="mechanism-step-title">{step.title}</div>
      <p className="mechanism-step-body">{step.body}</p>
    </li>
  );
}

export function HowItWorks() {
  const code = useReveal<HTMLDivElement>();

  return (
    <section id="how-it-works" className="mechanism gutter">
      <div className="mechanism-heading">Four steps, zero reimplementation</div>
      <h2 className="mechanism-title">
        Verification and settlement
        <br />
        are @x402/stellar. Unmodified.
      </h2>

      <ol className="mechanism-steps">
        {STEPS.map((step, i) => (
          <StepItem key={step.index} step={step} delay={i * 0.1} />
        ))}
      </ol>

      <div ref={code.ref} className={`mechanism-code ${code.className}`}>
        <div className="mechanism-code-label">packages/core — one declaration</div>
        <pre className="mechanism-code-block">
          <code>{SNIPPET}</code>
        </pre>
      </div>
    </section>
  );
}
