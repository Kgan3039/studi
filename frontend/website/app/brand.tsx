"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function Brand() {
  const [ripple, setRipple] = useState(0);

  return (
    <Link className="brand" href="/" onClick={() => setRipple(Date.now())}>
      <span className="brand-mark">
        <span className="brand-ring" aria-hidden="true" />
        {ripple > 0 ? <span className="brand-ripple" aria-hidden="true" key={ripple} /> : null}
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
