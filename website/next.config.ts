import type { NextConfig } from 'next';

/**
 * Static export for GitHub Pages. Set NEXT_PUBLIC_BASE_PATH=/rivertide-website when the site is
 * served from a project subpath; leave it empty for a custom domain or local preview.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  transpilePackages: ['@rivertide/leafy', '@rivertide/island'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
