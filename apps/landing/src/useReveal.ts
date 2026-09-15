import { useEffect, useRef, useState } from "react";

/**
 * Fades an element in the first time it enters the viewport. No animation library — a single
 * IntersectionObserver per element, disconnected after it fires once. Pairs with the `.reveal` /
 * `.reveal-visible` classes in index.css, which also carry the `prefers-reduced-motion` guard.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting === true) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, className: visible ? "reveal reveal-visible" : "reveal" };
}
