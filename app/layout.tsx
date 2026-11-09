import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { siteConfig } from "@/config/site";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// --- metadata block: owned by tc-seo ----------------------------------------
const defaultTitle = `${siteConfig.name} — ${siteConfig.tagline.replace(/\.$/, "")}`;
const description = `${siteConfig.name} takes a TikTok post or product link to a launch-ready TikTok ad campaign, with a Shopify product page built along the way.`;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.canonicalUrl),
  title: {
    default: defaultTitle,
    template: `%s — ${siteConfig.name}`,
  },
  description,
  applicationName: siteConfig.name,
  alternates: { canonical: siteConfig.links.home },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.links.home,
    siteName: siteConfig.name,
    title: defaultTitle,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description,
  },
  // Images come from app/opengraph-image.tsx, app/twitter-image.tsx;
  // icons from app/icon.svg, app/apple-icon.tsx, app/favicon.ico.
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
  ],
  colorScheme: "dark light",
};
// --- end metadata block -----------------------------------------------------

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
