import type { Metadata } from 'next';
import { Cormorant_Garamond, Source_Sans_3 } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';

import './globals.css';

const displayFont = Cormorant_Garamond({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

const uiFont = Source_Sans_3({
  variable: '--font-ui',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Clearpage',
  description: 'Paste any URL. Get a clean, exportable document.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${uiFont.variable}`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
