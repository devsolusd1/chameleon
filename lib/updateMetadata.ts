import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  updateV1,
} from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import bs58 from 'bs58';
import { BASE_URL, MINT_ADDRESS, RPC_URL } from './config';
import { parseSecretKey } from './keys';

/**
 * Updates name/symbol on-chain via Metaplex Token Metadata.
 * Default mode: the URI stays fixed (points to /api/metadata on this site).
 * Pinata mode: pass `newUri` with the freshly pinned IPFS metadata URL.
 */
export async function updateOnChainMetadata(
  newName: string,
  newSymbol: string,
  newUri?: string,
): Promise<string> {
  const secret = process.env.UPDATE_AUTHORITY_SECRET;
  if (!secret) throw new Error('UPDATE_AUTHORITY_SECRET is not configured on the server.');
  if (!MINT_ADDRESS) throw new Error('NEXT_PUBLIC_MINT_ADDRESS is not configured.');

  const umi = createUmi(RPC_URL).use(mplTokenMetadata());
  const kp = umi.eddsa.createKeypairFromSecretKey(parseSecretKey(secret));
  umi.use(keypairIdentity(kp));

  const mint = publicKey(MINT_ADDRESS);
  const current = await fetchMetadataFromSeeds(umi, { mint });

  const uri = newUri ?? `${BASE_URL}/api/metadata`;

  const result = await updateV1(umi, {
    mint,
    authority: umi.identity,
    data: {
      ...current,
      name: newName,
      symbol: newSymbol,
      uri,
    },
  }).sendAndConfirm(umi);

  return bs58.encode(result.signature);
}
