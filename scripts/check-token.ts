/**
 * Read-only sanity check: does the configured mint have Metaplex metadata,
 * is it mutable, and does the update authority match the configured wallet?
 *
 * Usage: npx tsx scripts/check-token.ts
 */
import 'dotenv/config';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fetchMetadataFromSeeds, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { parseSecretKey } from '../lib/keys';

async function main() {
  const rpc = process.env.RPC_URL!;
  const mintStr = process.env.NEXT_PUBLIC_MINT_ADDRESS!;
  const secret = process.env.UPDATE_AUTHORITY_SECRET!;
  if (!rpc || !mintStr || !secret) throw new Error('Fill RPC_URL, NEXT_PUBLIC_MINT_ADDRESS and UPDATE_AUTHORITY_SECRET in .env');

  const umi = createUmi(rpc).use(mplTokenMetadata());
  const walletPubkey = umi.eddsa.createKeypairFromSecretKey(parseSecretKey(secret)).publicKey;

  console.log('Mint:', mintStr);
  console.log('Configured wallet (pubkey):', walletPubkey.toString());

  const metadata = await fetchMetadataFromSeeds(umi, { mint: publicKey(mintStr) });

  console.log('\n--- On-chain metadata ---');
  console.log('Name:', metadata.name);
  console.log('Symbol:', metadata.symbol);
  console.log('URI:', metadata.uri);
  console.log('Update authority:', metadata.updateAuthority.toString());
  console.log('Is mutable:', metadata.isMutable);

  const authorityOk = metadata.updateAuthority.toString() === walletPubkey.toString();
  console.log('\n--- Checks ---');
  console.log(authorityOk ? '✅ Update authority matches the configured wallet' : '❌ Update authority DOES NOT match the configured wallet');
  console.log(metadata.isMutable ? '✅ Metadata is mutable' : '❌ Metadata is IMMUTABLE — the site cannot change it');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
