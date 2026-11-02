"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

export type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Delay in seconds (use small steps, e.g. 0.05 * index, for staggering). */
  delay?: number;
  /** Initial vertical offset in px. */
  y?: number;
};

/**
 * Fades + slides children in once when they scroll into view.
 *
 * Reduced motion: no-op. Markup is identical on server and client (no hydration
 * mismatch); `motion-reduce:` classes force the final state with `!important`
 * (beats motion's inline style, even before hydration) and the transition
 * duration drops to 0.
 */
export function Reveal({ children, className, delay = 0, y = 16 }: RevealProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={cn("motion-reduce:transform-none! motion-reduce:opacity-100!", className)}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={reduce ? { duration: 0 } : { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
