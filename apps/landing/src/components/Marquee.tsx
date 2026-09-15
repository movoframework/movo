const ACCENT_TEXT = "Verify — Settle — Discover — Repeat — Verify — Settle — Discover — Repeat — ";
const WHITE_TEXT =
  "Composed over @x402/stellar — never reimplemented — Composed over @x402/stellar — never reimplemented — ";

export function Marquee() {
  return (
    <section className="marquee-section">
      <div className="marquee-row accent">
        <div className="marquee-track">
          <span>{ACCENT_TEXT}</span>
          <span>{ACCENT_TEXT}</span>
        </div>
      </div>
      <div className="marquee-row white reverse">
        <div className="marquee-track">
          <span>{WHITE_TEXT}</span>
          <span>{WHITE_TEXT}</span>
        </div>
      </div>
    </section>
  );
}
