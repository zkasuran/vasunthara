"use client";

import { useEffect } from "react";

// Adds an "in" class to any .reveal element as it scrolls into view, driving
// the fade-and-rise animation defined in globals.css. Pure IntersectionObserver,
// no dependency.
export function Reveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window)) {
      for (const el of els) {
        el.classList.add("in");
      }
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.14 }
    );
    for (const el of els) {
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return null;
}
