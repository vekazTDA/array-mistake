import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Inter is self-hosted by next/font — no runtime request to Google, and no
 * layout shift while it loads.
 *
 * ClashDisplay isn't on Google Fonts, so it's pulled from Fontshare in
 * globals.css. That is a third-party request at runtime; see the note there.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Credit monitoring",
  description: "Check your credit report and score.",
  // Credit pages have no business being indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/*
          ClashDisplay, from Fontshare. Loaded as a <link> rather than an
          @import in globals.css — next/font puts Inter's @font-face rules
          first, which would push an @import past the first rule and make the
          browser drop it silently.
        */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f%5B%5D=clash-display@500,600,700&display=swap"
        />
      </head>
      {/*
        Browser extensions (Grammarly, password managers) inject attributes
        into <body> before React hydrates, which React reports as a mismatch.
        Suppression is one level deep, so real mismatches inside the app still
        surface normally.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
