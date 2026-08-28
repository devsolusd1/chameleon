import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Providers from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

const TITLE = 'Chameleon — the coin that changes its skin';
const DESCRIPTION =
  "Pay 2 SOL to change the coin's name, ticker and image. Straight on-chain, with a cooldown between changes.";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    siteName: 'Chameleon',
    type: 'website',
    images: [{ url: '/logo.png', width: 1250, height: 1250 }],
  },
  twitter: {
    card: 'summary',
    site: '@chameleonsol',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/logo.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
