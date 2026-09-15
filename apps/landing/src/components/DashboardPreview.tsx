import { motion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Calendar,
  CheckSquare,
  Download,
  FolderRoot,
  HelpCircle,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";

const EASE = [0.25, 0.1, 0.25, 1] as const;

const containerVariants = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, delay: 0.4, ease: EASE, staggerChildren: 0.1, delayChildren: 0.6 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const NAV_ITEMS: ReadonlyArray<{ label: string; icon: typeof LayoutDashboard; active?: boolean }> =
  [
    { label: "Dashboard", icon: LayoutDashboard, active: true },
    { label: "Catalog", icon: FolderRoot },
    { label: "Settlements", icon: Activity },
    { label: "Verifications", icon: CheckSquare },
    { label: "Sponsors", icon: Users },
    { label: "Agent calls", icon: MessageSquare },
    { label: "Listings", icon: Tag },
  ];

function SidebarItem({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-black/5 font-medium text-neutral-950"
          : "text-neutral-500 hover:bg-black/5 hover:text-neutral-950",
      )}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

function InitialsAvatar() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-neutral-900 text-sm font-semibold text-[#D5FF3E]">
      MO
    </div>
  );
}

/** A funnel bar: verify -> settle -> reject, the three real outcomes a Movo payment has. */
function OutcomeBar() {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/5">
      <motion.div
        className="h-full bg-neutral-900"
        initial={{ width: 0 }}
        whileInView={{ width: "60%" }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay: 1 }}
      />
      <motion.div
        className="h-full bg-[#D5FF3E]"
        initial={{ width: 0 }}
        whileInView={{ width: "32%" }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay: 1.2 }}
      />
      <motion.div
        className="h-full bg-neutral-300"
        initial={{ width: 0 }}
        whileInView={{ width: "8%" }}
        viewport={{ once: true }}
        transition={{ duration: 1, delay: 1.4 }}
      />
    </div>
  );
}

/** The nDCG@10 trend line — the one real metric on this page's evidence. */
function SearchQualityChart() {
  return (
    <div className="relative min-h-[280px]">
      <svg
        viewBox="0 0 800 200"
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label="Search quality trend, nDCG at 10, rising to 0.9332"
      >
        <motion.path
          d="M0,180 L160,155 L320,140 L480,95 L640,55 L800,40"
          fill="none"
          stroke="#111110"
          strokeOpacity={0.8}
          strokeWidth={3}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 2, delay: 1.5, ease: "easeInOut" }}
        />
        <motion.circle
          cx={640}
          cy={55}
          r={5}
          fill="#D5FF3E"
          stroke="#111110"
          strokeWidth={1.5}
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 3 }}
        />
        <motion.line
          x1={640}
          y1={55}
          x2={640}
          y2={200}
          stroke="#d3d3c9"
          strokeDasharray="4 4"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 3 }}
          style={{ transformOrigin: "640px 55px" }}
        />
      </svg>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 3.2 }}
        className="absolute top-4 left-[70%] -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-bold text-white shadow-xl"
      >
        <div>nDCG@10</div>
        <div>0.9332</div>
      </motion.div>
      <div className="mt-2 flex justify-between text-xs text-neutral-400">
        {["M1", "M2", "M3", "M4", "M6", "M7"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

const VERIFICATION_BARS: ReadonlyArray<{ label: string; heightPct: number }> = [
  { label: "Mon", heightPct: 40 },
  { label: "Tue", heightPct: 60 },
  { label: "Wed", heightPct: 32 },
  { label: "Thu", heightPct: 80 },
  { label: "Fri", heightPct: 52 },
  { label: "Sat", heightPct: 70 },
];

function VerificationBars() {
  return (
    <div className="flex h-32 items-end gap-2">
      {VERIFICATION_BARS.map((bar, index) => (
        <div key={bar.label} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex h-full w-full items-end rounded-md bg-black/5">
            <motion.div
              className="w-full rounded-md bg-neutral-900/70"
              initial={{ height: 0 }}
              whileInView={{ height: `${String(bar.heightPct)}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 1.5 + index * 0.1 }}
            />
          </div>
          <span className="text-[10px] text-neutral-400">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

const REJECTION_REASONS: ReadonlyArray<{ label: string; pct: number; color: string }> = [
  { label: "wrong_amount", pct: 45, color: "bg-neutral-900" },
  { label: "wrong_asset", pct: 36, color: "bg-[#8a9a12]" },
];

export function DashboardPreview() {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      className="relative mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-[40px] border border-black/10 bg-white/80 text-neutral-800 shadow-2xl backdrop-blur-2xl md:flex-row"
    >
      <span className="absolute top-5 right-6 z-10 rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium tracking-wide text-neutral-500 uppercase">
        Preview — illustrative
      </span>

      <div className="hidden w-64 shrink-0 flex-col border-r border-black/10 p-6 lg:flex">
        <div className="mb-8 flex items-center gap-2 text-[15px] font-bold text-neutral-950">
          <svg className="h-6 w-6 rounded-[6px]" viewBox="0 0 32 32" fill="none" aria-hidden="true">
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
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.label}
              icon={item.icon}
              label={item.label}
              active={item.active ?? false}
            />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-black/10 pt-6">
          <SidebarItem icon={HelpCircle} label="Docs" />
          <SidebarItem icon={Settings} label="Settings" />
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <motion.header
          variants={itemVariants}
          className="flex h-16 items-center justify-between border-b border-black/10 px-8"
        >
          <div className="relative hidden w-96 sm:block">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="text"
              placeholder="Search the catalog…"
              readOnly
              className="w-full rounded-lg border border-black/10 bg-black/[0.03] py-2 pr-4 pl-10 text-sm text-neutral-900 placeholder-neutral-400 focus:ring-1 focus:ring-black/20 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-5">
            <Download size={18} className="text-neutral-400" />
            <div className="relative">
              <Bell size={18} className="text-neutral-400" />
              <span className="absolute top-0 right-0 h-2 w-2 rounded-full border-2 border-white bg-[#8a9a12]" />
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-neutral-950">Facilitator ops</div>
              <div className="text-xs text-neutral-400">ops@movoframework.dev</div>
            </div>
            <InitialsAvatar />
          </div>
        </motion.header>

        <main className="flex-1 space-y-6 p-8">
          <motion.div variants={itemVariants} className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-neutral-950">Facilitator dashboard</h2>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-1.5 text-sm text-neutral-600">
                <Calendar size={14} />
                Live — testnet
              </span>
              <motion.a
                href="https://github.com/movoframework/movo/blob/main/docs/quickstart.md"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
              >
                <Sparkles size={14} />
                Read the docs
              </motion.a>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <motion.div
                variants={itemVariants}
                whileHover={{ y: -4 }}
                className="rounded-2xl border border-black/10 bg-black/[0.02] p-6 transition-colors hover:bg-black/[0.04]"
              >
                <div className="mb-1 text-sm text-neutral-500">Verified requests (preview)</div>
                <div className="mb-1 flex items-center gap-3">
                  <span className="text-3xl font-bold text-neutral-950">12,480</span>
                  <span className="flex items-center gap-1 rounded-full bg-[#D5FF3E]/25 px-2 py-0.5 text-xs font-semibold text-[#5c6a0d]">
                    <ArrowUpRight size={12} />
                    +12.4%
                  </span>
                </div>
                <div className="mb-4 text-xs text-neutral-400">
                  last 30 days, testnet, exact scheme
                </div>
                <OutcomeBar />
                <div className="mt-3 flex gap-4 text-xs text-neutral-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-neutral-900" /> verified
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#D5FF3E]" /> settled
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-neutral-300" /> rejected
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-4 text-sm">
                  <span className="text-neutral-500">Next milestone</span>
                  <span className="font-medium text-neutral-950">Pubnet rollout</span>
                </div>
              </motion.div>

              <motion.div
                variants={itemVariants}
                className="flex flex-1 flex-col rounded-2xl border border-black/10 bg-black/[0.02] p-6"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-neutral-500">Search quality over milestones</span>
                  <span className="rounded-md bg-black/5 px-2 py-1 text-xs text-neutral-700">
                    nDCG@10
                  </span>
                </div>
                <SearchQualityChart />
              </motion.div>
            </div>

            <div className="space-y-6">
              <motion.div
                variants={itemVariants}
                className="rounded-2xl border border-black/10 bg-black/[0.02] p-6"
              >
                <div className="mb-1 text-sm text-neutral-500">Payment outcomes (preview)</div>
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-2xl font-bold text-neutral-950">18,000</span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-[#5c6a0d]">
                    <ArrowUpRight size={12} />
                    +28.09%
                  </span>
                </div>
                <VerificationBars />
              </motion.div>

              <motion.div
                variants={itemVariants}
                className="rounded-2xl border border-black/10 bg-black/[0.02] p-6"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm text-neutral-500">Top rejection reasons</span>
                  <MoreHorizontal size={16} className="text-neutral-400" />
                </div>
                <div className="space-y-4">
                  {REJECTION_REASONS.map((reason, index) => (
                    <div key={reason.label}>
                      <div className="mb-1.5 flex justify-between text-xs text-neutral-600">
                        <span>{reason.label}</span>
                        <span>{reason.pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
                        <motion.div
                          className={cn("h-full", reason.color)}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${String(reason.pct)}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 1, delay: 2 + index * 0.2 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <a
                  href="https://github.com/movoframework/movo/blob/main/docs/CONFORMANCE.md"
                  className="mt-4 block text-center text-sm text-neutral-500 hover:text-neutral-950"
                >
                  View all reasons
                </a>
              </motion.div>
            </div>
          </div>
        </main>
      </div>
    </motion.div>
  );
}
