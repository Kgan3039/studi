import type { Metadata } from "next";
import { Arapey, Cormorant_Garamond } from "next/font/google";
import Link from "next/link";
import Brand from "./brand";
import "./globals.css";

const contactEmail = "isp.studi@gmail.com";
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
          <div className="footer-links">
            <Link href="/how-it-works">How it works</Link>
            <span aria-hidden="true">•</span>
            <Link href="/privacy">Privacy</Link>
            <span aria-hidden="true">•</span>
            <Link href="/support">Support</Link>
            <span aria-hidden="true">•</span>
            <a href={`mailto:${contactEmail}`}>Contact: {contactEmail}</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
