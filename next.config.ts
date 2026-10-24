import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// A build stamp, so anyone looking at a screen can say which build produced it. Read once at build
// time; if git is unavailable the stamp degrades to the date rather than failing the build.
function buildStamp(): string {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return `${sha} · ${date}`;
  } catch {
    return date;
  }
}

// The application is a single-tenant operational tool served from one origin. These headers are
// the host-side half of the protection the browser can actually enforce (a meta tag cannot set
// frame-ancestors or HSTS); see docs/DECISIONS.md D-49.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    // Next injects inline bootstrap scripts, so 'unsafe-inline' is required for scripts unless a
    // nonce-based policy is wired through middleware (recorded as follow-up work in D-49).
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      // Fonts are self-hosted (@fontsource), so no third-party origin is allowed to serve them.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

// HSTS only where TLS is actually terminated in front of this server. A blanket
// `includeSubDomains` on a workstation that also serves plain HTTP over the LAN would lock the
// operator out of their own address, so it is opt-in and documented (audit F-10).
if (process.env.HTTPS === "1") {
  securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
}

// A hosted preview is shown inside someone else's frame, which the production policy forbids on
// purpose. PREVIEW_EMBED relaxes exactly two directives and nothing else; it is never set on a real
// installation, and the default remains "no framing at all".
const embeddable = process.env.PREVIEW_EMBED === "1";
if (embeddable) {
  const frame = securityHeaders.find((h) => h.key === "X-Frame-Options");
  if (frame) securityHeaders.splice(securityHeaders.indexOf(frame), 1);
  const csp = securityHeaders.find((h) => h.key === "Content-Security-Policy");
  if (csp) csp.value = csp.value.replace("frame-ancestors 'none'", "frame-ancestors *");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD: buildStamp() },
  poweredByHeader: false,
  // Native/server-only packages must not be bundled by the client compiler.
  serverExternalPackages: ["@node-rs/argon2", "pg", "kysely"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
