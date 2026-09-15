interface CodeBlockProps {
  readonly label: string;
  readonly code: string;
}

/** A titled, plain-monospace code sample. No syntax highlighting — the code is short enough to read without it, and it keeps every sample a single source string that can be copy-pasted verbatim. */
export function CodeBlock({ label, code }: CodeBlockProps) {
  return (
    <div>
      <div style={{ fontSize: "0.8rem", color: "var(--color-text-faint)", marginBottom: "0.5rem" }}>
        {label}
      </div>
      <div className="code-block">
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
