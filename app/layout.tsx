import type { Metadata } from 'next';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chameleon — the coin that changes its skin',
  description:
    'Burn 0.1% of your tokens for the power to change the coin\'s name, ticker and image. Straight on-chain, with a 2-minute cooldown.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
