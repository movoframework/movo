import { motion } from "framer-motion";

const IMAGE_URL =
  "https://images.unsplash.com/photo-1545987796-200677ee1011?q=80&w=2400&auto=format&fit=crop";

/**
 * The hero backdrop — a real photo now, chosen for what it actually is rather than for a vague
 * "tech" mood: Tomás Saraceno's "Algo-r-(h)-i-(y)-thm(s)" installation, a lattice of
 * interconnected metal nodes. That's the same shape as the diagram this replaced (agent /
 * facilitator / Stellar, connected), so the hotspot annotations below still point at something
 * that reads as a network, not at an arbitrary background.
 */
export function NetworkVisual() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-white">
      <motion.img
        src={IMAGE_URL}
        alt=""
        referrerPolicy="no-referrer"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />
      {/* A scrim so the dark headline text over the left/top of the photo stays readable,
          fading out toward the right where the hotspots annotate the structure itself. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.9) 30%, rgba(255,255,255,0.55) 52%, rgba(255,255,255,0.15) 70%, rgba(255,255,255,0.05) 100%)",
        }}
      />
      <a
        href="https://unsplash.com/@alinnnaaaa"
        className="absolute right-4 bottom-4 z-10 text-[11px] text-neutral-500 hover:text-neutral-800"
      >
        Photo: Alina Grubnyak / Unsplash
      </a>
    </div>
  );
}
