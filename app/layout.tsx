import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Clearpage',
  description: 'Paste any URL. Get a clean, exportable document.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
