import { CONFORMANCE_URL, QUICKSTART_URL, REPO_URL } from "../repo.ts";

export function Footer() {
  return (
    <footer id="footer" className="footer gutter">
      <span>&copy; {new Date().getFullYear()} Movo — Apache-2.0</span>
      <div className="footer-links">
        <a href={REPO_URL}>GitHub</a>
        <a href={QUICKSTART_URL}>Docs</a>
        <a href={CONFORMANCE_URL}>Conformance</a>
      </div>
    </footer>
  );
}
