/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  poweredByHeader: false,
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
    };
    return config;
  },
};

module.exports = nextConfig;
