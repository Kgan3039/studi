import type { Metadata } from "next";
import { Arapey } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const contactEmail = "isp.studi@gmail.com";
const arapey = Arapey({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-arapey",
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
    <html lang="en" className={arapey.variable} data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <header className="site-header">
          <nav className="nav" aria-label="Main navigation">
            <Link className="brand" href="/">
              <span className="brand-mark">
                <span className="brand-glow" aria-hidden="true" />
                <Image
                  src="/studi-logo.png"
                  alt=""
                  className="brand-logo"
                  width={46}
                  height={50}
                  priority
                />
              </span>
              <span>Studi</span>
            </Link>
            <div className="nav-links">
              <Link href="/privacy">Privacy</Link>
              <Link href="/support">Support</Link>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="footer-links">
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
