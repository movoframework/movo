import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils.ts";

const REPO_URL = "https://github.com/movoframework/movo";

const LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Evidence", href: "#evidence" },
  { label: "Features", href: "#features" },
  { label: "Docs", href: `${REPO_URL}/blob/main/docs/quickstart.md` },
];

const EASE = [0.25, 0.1, 0.25, 1] as const;

/** The bars of the hamburger, morphed into an X via the same three elements rather than swapped icons — the identity of each bar is what makes the morph read as one shape turning into another. */
function HamburgerBars({ open }: { open: boolean }) {
  return (
    <div className="flex h-8 w-8 flex-col items-center justify-center gap-[5px]">
      <span
        className={cn(
          "h-[2px] w-5 bg-neutral-900 transition-all duration-300",
          open && "translate-y-[7px] rotate-45",
        )}
      />
      <span
        className={cn(
          "h-[2px] w-5 bg-neutral-900 transition-all duration-300",
          open && "opacity-0",
        )}
      />
      <span
        className={cn(
          "h-[2px] w-5 bg-neutral-900 transition-all duration-300",
          open && "-translate-y-[7px] -rotate-45",
        )}
      />
    </div>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="relative z-50 px-4 pt-6 pb-2 md:px-8"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between rounded-full border border-black/10 bg-white/70 p-2 px-4 shadow-sm backdrop-blur-xl">
          <a href="#top" className="flex items-center gap-2 text-[15px] font-bold text-neutral-900">
            <svg
              className="h-[22px] w-[22px] rounded-[6px]"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="8" fill="#111110" />
              <path
                d="M7 22V10l9 8 9-8v12"
                stroke="#D5FF3E"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            Movo
          </a>

          <div className="hidden items-center gap-5 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="group relative whitespace-nowrap text-[13px] font-medium text-neutral-600 hover:text-neutral-950"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-neutral-900 transition-all group-hover:w-full" />
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <a
              href={`${REPO_URL}/blob/main/docs/CONFORMANCE.md`}
              className="px-3 text-[13px] font-medium text-neutral-600 hover:text-neutral-950"
            >
              Conformance
            </a>
            <a
              href={REPO_URL}
              className="rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-semibold text-white transition-all hover:scale-105 hover:bg-[#D5FF3E] hover:text-black active:scale-95"
            >
              View on GitHub
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <HamburgerBars open={open} />
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white/95 p-4 shadow-lg backdrop-blur-xl md:hidden"
            >
              {LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-[15px] text-neutral-700 hover:bg-black/5 hover:text-neutral-950"
                >
                  {link.label}
                </a>
              ))}
              <div className="my-1 h-px bg-black/10" />
              <a
                href={`${REPO_URL}/blob/main/docs/CONFORMANCE.md`}
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-[15px] text-neutral-700 hover:text-neutral-950"
              >
                Conformance
              </a>
              <a
                href={REPO_URL}
                onClick={() => setOpen(false)}
                className="rounded-full bg-neutral-900 px-5 py-2.5 text-center text-[15px] font-semibold text-white"
              >
                View on GitHub
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  );
}
