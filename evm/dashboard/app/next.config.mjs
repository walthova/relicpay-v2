import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.join(here, '..');
const repoRoot = path.join(dashboard, '..');

/**
 * The app imports ../lib, which sits above this project root. Two consequences are configured here.
 *
 * 1. `outputFileTracingRoot` has to reach the repo root or a production build traces the app
 *    directory only and ships without the data layer.
 * 2. `viem` is aliased to this project's copy. dashboard/lib is CommonJS resolved from its own
 *    location, so left alone it would pick up the root manifest's viem while the client components
 *    use this one, and two copies of viem in one bundle means two `getAddress` implementations
 *    disagreeing about a checksum.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  outputFileTracingRoot: repoRoot,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      viem: path.join(here, 'node_modules', 'viem'),
    };
    return config;
  },
};

export default nextConfig;
