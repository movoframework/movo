import { useState } from "react";
import { QUICKSTART_URL, REPO_URL } from "../repo.ts";

const LINKS: readonly { label: string; href: string }[] = [
  { label: "Features", href: "#services" },
  { label: "Evidence", href: "#evidence" },
  { label: "Get Started", href: "#cta" },
  { label: "Docs", href: QUICKSTART_URL },
];

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.93c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="nav">
      <a className="nav-logo" href="#top">
        MOVO
      </a>

      <div className="nav-pill">
        {LINKS.map((link) => (
          <a key={link.label} href={link.href}>
            {link.label}
          </a>
        ))}
      </div>

      <div className="nav-social">
        <a href={REPO_URL}>
          <span className="visually-hidden">GitHub</span>
          <GithubIcon />
        </a>

        <button
          type="button"
          className="nav-hamburger"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          <span className="visually-hidden">{open ? "Close menu" : "Open menu"}</span>
          <span className={open ? "nav-hamburger-bar open" : "nav-hamburger-bar"} />
          <span className={open ? "nav-hamburger-bar open" : "nav-hamburger-bar"} />
          <span className={open ? "nav-hamburger-bar open" : "nav-hamburger-bar"} />
        </button>
      </div>

      {open ? (
        <div id="mobile-menu" className="nav-mobile">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href={REPO_URL} onClick={() => setOpen(false)}>
            GitHub
          </a>
        </div>
      ) : null}
    </nav>
  );
}
