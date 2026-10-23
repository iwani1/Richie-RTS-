import type { Metadata, Viewport } from "next";
// Self-hosted typefaces, so first paint is identical with or without a network connection. Inter
// carries every word and number; Plex Mono is reserved for machine data (references, plates, times).
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../index.css";

export const metadata: Metadata = {
  title: "Richie Transport Services — Operations",
  description: "Staff busing, bus rentals and fleet logistics for Richie Transport Services.",
};

export const viewport: Viewport = { themeColor: "#f5f6f9", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
