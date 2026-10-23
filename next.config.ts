import type { NextConfig } from "next";

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
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native/server-only packages must not be bundled by the client compiler.
  serverExternalPackages: ["@node-rs/argon2", "pg", "kysely"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
