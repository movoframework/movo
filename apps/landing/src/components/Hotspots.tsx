import { motion } from "framer-motion";

interface HotspotProps {
  readonly wrapperClassName: string;
  readonly fadeDelay: number;
  readonly connectorClassName: string;
  readonly connectorTransform?: string;
  readonly path: string;
  readonly pathDelay: number;
  readonly labelClassName: string;
  readonly labelDelay: number;
  readonly lines: readonly [string, string];
}

/** One pulsing dot, one hand-drawn connector line, one label — the annotation unit reused for both hotspots below. */
function Hotspot({
  wrapperClassName,
  fadeDelay,
  connectorClassName,
  connectorTransform,
  path,
  pathDelay,
  labelClassName,
  labelDelay,
  lines,
}: HotspotProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: fadeDelay, duration: 1 }}
      className={wrapperClassName}
    >
      <div className="relative">
        <div className="h-3 w-3 animate-pulse rounded-full bg-[#8a9a12] shadow-[0_0_15px_rgba(138,154,18,0.5)]" />
        <svg
          className={connectorClassName}
          style={connectorTransform === undefined ? undefined : { transform: connectorTransform }}
          aria-hidden="true"
        >
          <motion.path
            d={path}
            fill="none"
            stroke="#111110"
            strokeOpacity={0.4}
            strokeWidth={1}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: pathDelay, duration: 0.8 }}
          />
        </svg>
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: labelDelay, duration: 0.6 }}
          className={labelClassName}
        >
          <span className="text-[14px] font-light tracking-wide text-neutral-800">
            {lines[0]}
            <br />
            {lines[1]}
          </span>
        </motion.div>
      </div>
    </motion.div>
  );
}

/** Two annotations pointing at the payment-network diagram, matching real Movo behaviour instead of decorative body-part callouts. */
export function Hotspots() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 hidden lg:block">
      <Hotspot
        wrapperClassName="absolute top-[41%] right-[28%]"
        fadeDelay={1.5}
        connectorClassName="absolute top-1.5 left-1.5 h-[60px] w-[150px]"
        connectorTransform="translate(0, -100%)"
        path="M 0 60 L 40 20 L 120 20"
        pathDelay={2}
        labelClassName="absolute top-[-55px] left-[125px] whitespace-nowrap"
        labelDelay={2.8}
        lines={["Verified & settled", "on Stellar"]}
      />
      <Hotspot
        wrapperClassName="absolute bottom-[30%] right-[36%]"
        fadeDelay={2.1}
        connectorClassName="absolute top-1.5 left-1.5 h-[80px] w-[120px]"
        path="M 0 0 L 40 40 L 100 40"
        pathDelay={2.6}
        labelClassName="absolute top-[30px] left-[105px] whitespace-nowrap"
        labelDelay={3.4}
        lines={["Budget enforced", "before signing"]}
      />
    </div>
  );
}
