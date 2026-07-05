"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

export default function Brand() {
  const [pop, setPop] = useState(0);
  const markRef = useRef<HTMLSpanElement>(null);

  // speed the bounce up in place instead of restarting it, so the pin
  // keeps moving from wherever it currently is
  const setSpeed = (rate: number) => {
    markRef.current
      ?.querySelectorAll<HTMLElement>(".brand-logo, .brand-ring")
      .forEach((el) => {
        el.getAnimations().forEach((animation) => {
          const name = (animation as CSSAnimation).animationName;
          if (name === "logo-bounce" || name === "ring-breathe") {
            animation.playbackRate = rate;
          }
        });
      });
  };

  return (
    <Link
      className="brand"
      href="/"
      onClick={() => setPop(Date.now())}
      onMouseEnter={() => setSpeed(2)}
      onMouseLeave={() => setSpeed(1)}
    >
      <span className="brand-mark" ref={markRef}>
        <span
          className={`brand-ring${pop ? " ring-pop" : ""}`}
          key={pop}
          aria-hidden="true"
          onAnimationEnd={() => setPop(0)}
        />
        <Image
          src="/studi-logo.png"
          alt=""
          className="brand-logo"
          width={46}
          height={50}
          priority
        />
      </span>
      <span className="brand-text">Studi</span>
    </Link>
  );
}
