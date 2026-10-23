import type { Metadata, Viewport } from "next";
// Self-hosted typefaces. These were previously fetched from fonts.googleapis.com at runtime, which
// made an offline workstation fall back to Georgia/Arial/monospace and silently lose the identity.
// The three families now ship with the application (variable Archivo and Fraunces, static Plex Mono),
// so first paint is identical with or without a network connection.
import "@fontsource-variable/archivo";
import "@fontsource-variable/fraunces";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "../index.css";

export const metadata: Metadata = {
  title: "Richie Transport Services — Operations Ledger",
  description: "Staff busing, bus rentals and fleet logistics for Richie Transport Services.",
};

export const viewport: Viewport = { themeColor: "#12251D", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
