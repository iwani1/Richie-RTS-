import type { Metadata, Viewport } from "next";
// Self-hosted typefaces, so first paint is identical with or without a network connection. Inter
// carries every word and number. JetBrains Mono is the design system's machine face (references,
// plate numbers, times, captions); IBM Plex Mono stays only until the last screen that still reads
// `legacy.css` is converted, and both imports leave with it.
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Richie Transport Services — Operations",
  description: "Staff busing, bus rentals and fleet logistics for Richie Transport Services.",
};

export const viewport: Viewport = { themeColor: "#0E0E10", width: "device-width", initialScale: 1, colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
