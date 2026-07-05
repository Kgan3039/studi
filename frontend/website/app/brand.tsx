"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function Brand() {
  const [pop, setPop] = useState(0);

  return (
    <Link className="brand" href="/" onClick={() => setPop(Date.now())}>
      <span className="brand-mark">
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
