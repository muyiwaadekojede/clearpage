import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', '@sparticuz/chromium', 'better-sqlite3'],
};

export default nextConfig;
