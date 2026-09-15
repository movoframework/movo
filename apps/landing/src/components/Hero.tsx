import { motion, type Variants } from "framer-motion";
import { Bot, Radar, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { CopyCommand } from "./CopyCommand.tsx";
import { DashboardPreview } from "./DashboardPreview.tsx";
import { Hotspots } from "./Hotspots.tsx";
import { NetworkVisual } from "./NetworkVisual.tsx";

const REPO_URL = "https://github.com/movoframework/movo";

const ICON_CLUSTER: ReadonlyArray<{ name: string; Icon: typeof Radar }> = [
  { name: "discover", Icon: Radar },
  { name: "pay", Icon: Wallet },
  { name: "verify", Icon: ShieldCheck },
  { name: "agent", Icon: Bot },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.21, 0.47, 0.32, 0.98] } },
};

export function Hero() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section id="top" className="w-full">
      <div
        className="relative h-[950px] w-full overflow-hidden"
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        <NetworkVisual />
        <Hotspots />

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isVisible ? "visible" : "hidden"}
          className="absolute top-[140px] left-[24px] z-20 max-w-[745px] md:left-[80px]"
        >
          <motion.h1
            variants={itemVariants}
            className="mb-8 flex flex-col justify-center text-[42px] leading-[1.05] font-[600] tracking-[-0.03em] text-neutral-950 md:h-[252px] md:text-[70px]"
          >
            Make Your API
            <br />
            Discoverable &amp;
            <span className="flex flex-wrap items-center gap-5">
              Payable
              <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.03] p-1.5 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)]">
                {ICON_CLUSTER.map(({ name, Icon }) => (
                  <span
                    key={name}
                    className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-black/10 bg-black/5 shadow-inner"
                  >
                    <Icon className="text-neutral-700" size={22} strokeWidth={1.2} />
                  </span>
                ))}
              </span>
            </span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mb-10 max-w-[540px] text-[18px] leading-relaxed font-light text-neutral-600 md:text-[20px]"
          >
            Define a resource once. Movo handles x402 verification and Stellar settlement,
            <br className="hidden md:block" />
            composed over @x402/stellar — never reimplemented.
          </motion.p>

          <motion.div variants={itemVariants}>
            <CopyCommand />
          </motion.div>

          <motion.div variants={itemVariants} className="flex flex-col gap-2">
            <span className="text-[16px] leading-tight text-neutral-600">
              <span className="font-semibold text-neutral-950">7 / 7</span> stock-client conformance
              scenarios
              <br />
              passing against the Movo facilitator on Stellar testnet.
            </span>
            <a
              href={`${REPO_URL}/blob/main/docs/CONFORMANCE.md`}
              className="text-[14px] text-[#8a9a12] hover:text-neutral-950"
            >
              See the evidence →
            </a>
          </motion.div>
        </motion.div>
      </div>

      <div className="w-full bg-white px-6 pb-16">
        <DashboardPreview />
      </div>
    </section>
  );
}
