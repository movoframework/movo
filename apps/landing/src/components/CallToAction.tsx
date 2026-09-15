import { REPO_URL } from "../repo.ts";
import { useReveal } from "../useReveal.ts";

export function CallToAction() {
  const heading = useReveal<HTMLHeadingElement>();

  return (
    <section id="cta" className="cta gutter">
      <h2 ref={heading.ref} className={`cta-heading ${heading.className}`}>
        Clone the
        <br />
        repo.
      </h2>
      <a className="cta-button" href={REPO_URL}>
        View on GitHub
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="19" x2="19" y2="5" />
          <polyline points="8 5 19 5 19 16" />
        </svg>
      </a>
    </section>
  );
}
