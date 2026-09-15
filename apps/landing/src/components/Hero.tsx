export function Hero() {
  return (
    <header id="top" className="hero gutter">
      <h1 className="hero-headline">
        Pay or
        <br />
        402.
      </h1>
      <p className="hero-sub">The x402 facilitator &amp; discovery layer for Stellar</p>

      <div className="hero-meta">
        <div className="hero-meta-label">
          License —<br />
          Apache-2.0
        </div>

        <div className="scroll-badge" aria-hidden="true">
          <svg className="spin" viewBox="0 0 144 144" aria-hidden="true">
            <defs>
              <path id="circlePath" d="M 72,72 m -60,0 a 60,60 0 1,1 120,0 a 60,60 0 1,1 -120,0" />
            </defs>
            <text>
              <textPath href="#circlePath">
                Scroll Down &#8226; Scroll Down &#8226; Scroll Down &#8226;
              </textPath>
            </text>
          </svg>
          <svg
            className="arrow"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="4" x2="12" y2="20" />
            <polyline points="6 14 12 20 18 14" />
          </svg>
        </div>

        <div className="hero-meta-right">
          Movo
          <span>Facilitator / Discovery</span>
        </div>
      </div>
    </header>
  );
}
