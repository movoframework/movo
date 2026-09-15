import type { CSSProperties } from "react";
import { REPO_URL } from "../repo.ts";
import { useReveal } from "../useReveal.ts";

interface Service {
  readonly index: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly href: string;
}

const SERVICES: readonly Service[] = [
  {
    index: "01",
    title: "Facilitator",
    tags: ["Stellar", "Signer pool", "Self-hostable"],
    href: `${REPO_URL}/blob/main/docs/operating-a-facilitator/deployment.md`,
  },
  {
    index: "02",
    title: "Discovery",
    tags: ["Auto-catalog", "No registration"],
    href: `${REPO_URL}/blob/main/docs/bazaar/overview.md`,
  },
  {
    index: "03",
    title: "Ranked search",
    tags: ["BM25", "Embeddings", "nDCG@10 0.93"],
    href: `${REPO_URL}/blob/main/docs/discovery/search-quality.md`,
  },
  {
    index: "04",
    title: "MCP for agents",
    tags: ["Search", "Pay", "Verify"],
    href: `${REPO_URL}/blob/main/docs/mcp/agent-integration.md`,
  },
  {
    index: "05",
    title: "Non-custodial",
    tags: ["Zero key custody"],
    href: `${REPO_URL}/blob/main/docs/security/key-management.md`,
  },
  {
    index: "06",
    title: "Buyer budgets",
    tags: ["Pre-sign enforcement", "Payto allowlist"],
    href: `${REPO_URL}/blob/main/docs/security/buyer-budgets.md`,
  },
];

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="8 5 19 5 19 16" />
    </svg>
  );
}

function ServiceRow({ service, delay }: { service: Service; delay: number }) {
  const { ref, className } = useReveal<HTMLAnchorElement>();

  return (
    <a
      ref={ref}
      className={`service ${className}`}
      href={service.href}
      style={{ "--reveal-delay": `${delay}s` } as CSSProperties}
    >
      <span className="service-index">{service.index}</span>
      <div>
        <div className="service-title">{service.title}</div>
        <div className="service-tags">
          {service.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <span className="service-arrow">
        <ArrowIcon />
      </span>
    </a>
  );
}

export function Services() {
  return (
    <section id="services" className="services gutter">
      <div className="services-heading">Six things that ship today, not a roadmap</div>

      {SERVICES.map((service, i) => (
        <ServiceRow key={service.index} service={service} delay={i * 0.08} />
      ))}
    </section>
  );
}
