import type { Metadata, Viewport } from "next";
// Self-hosted typefaces, so first paint is identical with or without a network connection. The
// editorial direction pairs a high-contrast display serif (Instrument Serif) with Archivo for text
// and Plex Mono for every machine datum.
import "@fontsource-variable/archivo";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "../index.css";

export const metadata: Metadata = {
  title: "Richie Transport Services — Operations Ledger",
  description: "Staff busing, bus rentals and fleet logistics for Richie Transport Services.",
};

export const viewport: Viewport = { themeColor: "#FDFCF8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
