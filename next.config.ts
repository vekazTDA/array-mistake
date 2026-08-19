import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Pin the workspace root to this directory. Without it Next walks up and
   * finds ~/pnpm-lock.yaml and ~/package.json — leftovers from another project
   * sitting loose in the home directory — and infers the wrong root.
   */
  outputFileTracingRoot: __dirname,

  /**
   * Array's components are loaded as third-party scripts from embed.array.io
   * and talk to Array directly from the browser. Nothing here proxies them.
   *
   * There is deliberately no Content-Security-Policy yet. Array's bundles are
   * 250–500KB of third-party code that mount custom elements and inject their
   * own styles, and a policy written without observing what they actually
   * request would either break the credit report or be so permissive it
   * proves nothing. The way in is Content-Security-Policy-Report-Only, with a
   * real enrolment and report render driven end to end while collecting
   * violations — which needs the Array server token first.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          // Credit pages have no legitimate reason to be framed.
          { key: "x-frame-options", value: "DENY" },
          { key: "content-security-policy", value: "frame-ancestors 'none'" },
          // Don't leak the path of a credit page to third parties.
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          {
            key: "permissions-policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "cross-origin-opener-policy", value: "same-origin" },
        ],
      },
      {
        // The token response must never be cached anywhere.
        source: "/api/array/:path*",
        headers: [{ key: "cache-control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
