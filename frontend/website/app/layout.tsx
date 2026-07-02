import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const contactEmail = "isp.studi@gmail.com";

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
    <html lang="en">
      <body>
        <header className="site-header">
          <nav className="nav" aria-label="Main navigation">
            <Link className="brand" href="/">
              <img src="/studi-logo.png" alt="" className="brand-logo" />
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
          <Link href="/privacy">Privacy</Link>
          <span aria-hidden="true">•</span>
          <Link href="/support">Support</Link>
          <span aria-hidden="true">•</span>
          <a href={`mailto:${contactEmail}`}>Contact: {contactEmail}</a>
        </footer>
      </body>
    </html>
  );
}
