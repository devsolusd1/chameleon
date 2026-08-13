import type { Metadata } from 'next';
import SkinsArchive from './SkinsArchive';

export const metadata: Metadata = {
  title: 'Skin archive — Chameleon',
  description: 'Every identity the chameleon has ever worn, each one paid for with a burn.',
};

export default function SkinsPage() {
  return <SkinsArchive />;
}
