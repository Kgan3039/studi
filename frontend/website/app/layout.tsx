import type { Metadata } from "next";
import { Arapey, Cormorant_Garamond } from "next/font/google";
import Link from "next/link";
import Brand from "./brand";
import "./globals.css";

const contactEmail = "isp.studi@gmail.com";
const instagramUrl = "https://www.instagram.com/join.studi/";
const linkedinUrl = "https://www.linkedin.com/company/joinstudi/";

function InstagramIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height="18"
      viewBox="0 0 24 24"
      width="18">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.17.053 1.805.249 2.227.413.56.218.96.478 1.38.898.42.42.68.82.898 1.38.164.422.36 1.057.413 2.227.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.053 1.17-.249 1.805-.413 2.227-.218.56-.478.96-.898 1.38-.42.42-.82.68-1.38.898-.422.164-1.057.36-2.227.413-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.17-.053-1.805-.249-2.227-.413-.56-.218-.96-.478-1.38-.898-.42-.42-.68-.82-.898-1.38-.164-.422-.36-1.057-.413-2.227-.058-1.266-.07-1.646-.07-4.85s.012-3.584.07-4.85c.053-1.17.249-1.805.413-2.227.218-.56.478-.96.898-1.38.42-.42.82-.68 1.38-.898.422-.164 1.057-.36 2.227-.413 1.266-.058 1.646-.07 4.85-.07zM12 0C8.741 0 8.332.014 7.052.072 5.775.13 4.902.333 4.14.63a5.88 5.88 0 0 0-2.126 1.384A5.88 5.88 0 0 0 .63 4.14C.333 4.902.13 5.775.072 7.052.014 8.332 0 8.741 0 12s.014 3.668.072 4.948c.058 1.277.261 2.15.558 2.912a5.88 5.88 0 0 0 1.384 2.126A5.88 5.88 0 0 0 4.14 23.37c.762.297 1.635.5 2.912.558C8.332 23.986 8.741 24 12 24s3.668-.014 4.948-.072c1.277-.058 2.15-.261 2.912-.558a5.88 5.88 0 0 0 2.126-1.384 5.88 5.88 0 0 0 1.384-2.126c.297-.762.5-1.635.558-2.912.058-1.28.072-1.689.072-4.948s-.014-3.668-.072-4.948c-.058-1.277-.261-2.15-.558-2.912a5.88 5.88 0 0 0-1.384-2.126A5.88 5.88 0 0 0 19.86.63c-.762-.297-1.635-.5-2.912-.558C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height="18"
      viewBox="0 0 24 24"
      width="18">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

const arapey = Arapey({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-arapey",
  display: "swap",
});
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: "500",
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Studi",
  description: "Study smarter with students in your classes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${arapey.variable} ${cormorant.variable}`}
      data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <header className="site-header">
          <nav className="nav" aria-label="Main navigation">
            <Brand />
            <div className="nav-links">
              <Link href="/how-it-works">How it works</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/support">Support</Link>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <a className="footer-contact" href={`mailto:${contactEmail}`}>
            <span className="footer-contact-label">Contact:</span>{" "}
            <span className="footer-contact-address">{contactEmail}</span>
          </a>
          <div className="footer-social">
            <a
              aria-label="Studi on Instagram"
              className="footer-social-link"
              href={instagramUrl}
              rel="noreferrer noopener"
              target="_blank">
              <InstagramIcon />
            </a>
            <a
              aria-label="Studi on LinkedIn"
              className="footer-social-link"
              href={linkedinUrl}
              rel="noreferrer noopener"
              target="_blank">
              <LinkedInIcon />
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
