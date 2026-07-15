import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// A warm editorial serif for headlines (trust/credibility, not a generic AI-template
// sans) paired with a clean, institutional sans for body copy (transparency/clarity).
const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "900"],
  style: ["normal", "italic"],
});
const sansFont = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});
const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

import { Providers } from "./providers";
import Navbar from "./components/Navbar";
import AssistantWidget from "./components/AssistantWidget";

export const metadata: Metadata = {
  title: "ImpactBridge - Trust-First NGO Donations",
  description: "ImpactBridge connects verified NGOs with donors using sequential milestone-based funding, AI-agent validations, and automated 80G tax receipt generation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${displayFont.variable} ${sansFont.variable} ${monoFont.variable} antialiased bg-gray-950 text-white font-sans`}
      >
        <Providers>
          <Navbar />
          {children}
          <AssistantWidget />
        </Providers>
      </body>
    </html>
  );
}
