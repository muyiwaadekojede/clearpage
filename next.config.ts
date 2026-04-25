import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium', 'better-sqlite3'],
  outputFileTracingIncludes: {
    '/api/extract': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/playwright-core/.local-browsers/**',
    ],
    '/api/export': [
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/playwright-core/.local-browsers/**',
    ],
  },
};

export default nextConfig;
