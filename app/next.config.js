const path = require("path");
/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  poweredByHeader: false,
  experimental: { externalDir: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  transpilePackages: [
    "@ledgerhq/errors",
    "@ledgerhq/devices",
    "@ledgerhq/hw-transport",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fix broken Ledger ESM exports — use browser-compatible CJS fallback
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    // Force CJS resolution for Ledger packages that have broken ESM
    config.resolve.alias = {
      ...config.resolve.alias,
      "@ledgerhq/errors": require.resolve("@ledgerhq/errors"),
      // The shared checkout SDK lives outside app/; pin its Solana deps to the
      // app's own copies so there is a single PublicKey class in the bundle.
      "@solana/web3.js": path.join(__dirname, "node_modules/@solana/web3.js"),
      "@solana/spl-token": path.join(__dirname, "node_modules/@solana/spl-token"),
    };
    return config;
  },
};

module.exports = nextConfig;
