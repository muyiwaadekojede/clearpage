import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', '@sparticuz/chromium', 'better-sqlite3'],
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
    ],
  },
};

export default nextConfig;
