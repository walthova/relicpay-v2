/** @type {import('next').NextConfig} */
const nextConfig = {
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
