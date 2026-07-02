"use client";

import { useEffect } from "react";

export default function ScrollReveal() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;

    const pending = new Set(
      Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")),
    );
    if (pending.size === 0) return;

    document.documentElement.classList.add("reveal-ready");

    const reveal = (el: HTMLElement, delay: number) => {
      el.style.transitionDelay = `${delay}ms`;
      el.classList.add("is-revealed");
      el.addEventListener(
        "transitionend",
        () => {
          el.style.transitionDelay = "";
        },
        { once: true },
      );
      pending.delete(el);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        let stagger = 0;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (!pending.has(el)) continue;
          if (entry.isIntersecting) {
            reveal(el, stagger);
            stagger += 70;
            observer.unobserve(el);
          }
        }
        // reveal anything that was jumped past between frames
        pending.forEach((el) => {
          if (el.getBoundingClientRect().bottom < 0) {
            reveal(el, 0);
            observer.unobserve(el);
          }
        });
      },
      { rootMargin: "0px 0px -80px 0px" },
    );

    pending.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return null;
}
