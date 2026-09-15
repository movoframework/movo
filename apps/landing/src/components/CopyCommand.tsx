import { Check, Terminal } from "lucide-react";
import { useState } from "react";

const COMMAND = "git clone https://github.com/movoframework/movo.git";

/**
 * Replaces the source pattern's email-capture row. An email field with no backend behind it
 * would imply a signup that doesn't exist — this is the same shape (pill, icon, input-like
 * field, accent button) but every part of it actually works: the command is real and runnable
 * today, and the button copies it to the clipboard rather than submitting to nowhere.
 */
export function CopyCommand() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-10 flex max-w-[560px] items-center rounded-full border border-black/10 bg-white p-2 shadow-lg">
      <div className="flex flex-grow items-center gap-4 overflow-hidden px-5">
        <Terminal className="size-[18px] shrink-0 text-neutral-400" />
        <code className="w-full truncate font-mono text-[15px] font-light text-neutral-700">
          {COMMAND}
        </code>
      </div>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="flex shrink-0 items-center gap-2 rounded-full bg-[#D5FF3E] px-8 py-4 text-[16px] font-semibold whitespace-nowrap text-black shadow-lg transition-all duration-300 hover:bg-[#c5f134]"
      >
        {copied ? <Check className="size-4" /> : null}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
