"use client";

import { animate, useInView } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";

const noopSubscribe = () => () => {};

/** `false` during SSR and hydration, `true` afterwards (no hydration mismatch). */
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Motion state for a mockup.
 * - `reduced`: user prefers reduced motion (only once hydrated, so the first
 *   client render always matches the server).
 * - `active`: animations may run (hydrated, motion allowed, on screen).
 */
export function useMockupMotion<T extends Element>(ref: RefObject<T | null>) {
  const prefersReduced = useReducedMotion();
  const hydrated = useHydrated();
  const inView = useInView(ref, { margin: "0px 0px -10% 0px" });
  const reduced = hydrated && prefersReduced === true;
  const active = hydrated && prefersReduced === false && inView;
  return { reduced, active, inView };
}

/**
 * One-shot entrance state. `shown` is true during SSR/hydration and under
 * reduced motion (final state rendered), false once hydrated until the element
 * first scrolls into view. `animate` tells whether transitions should run.
 */
export function useEntrance<T extends Element>(ref: RefObject<T | null>) {
  const prefersReduced = useReducedMotion();
  const hydrated = useHydrated();
  const seen = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const animate = hydrated && prefersReduced === false;
  return { shown: !animate || seen, animate };
}

/**
 * Cycles an index 0..count-1 every `intervalMs` while `running`.
 * State only changes from the timer callback.
 */
export function useCycle(count: number, intervalMs: number, running: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs, running]);
  return [index, setIndex] as const;
}

/**
 * Tweens a displayed number toward `target`. Returns `target` directly when
 * `animateEnabled` is false (reduced motion / before hydration).
 */
export function useAnimatedNumber(target: number, animateEnabled: boolean, duration = 0.6) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    if (!animateEnabled) {
      fromRef.current = target;
      return;
    }
    const controls = animate(fromRef.current, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        fromRef.current = v;
        setValue(v);
      },
    });
    return () => controls.stop();
  }, [target, animateEnabled, duration]);

  return animateEnabled ? value : target;
}
