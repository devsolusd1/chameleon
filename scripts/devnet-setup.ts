/**
 * DEVNET TEST SETUP — creates a test wallet, airdrops SOL, and creates a
 * fungible token with MUTABLE Metaplex metadata (same mechanics the site
 * uses in production with the DBC token).
 *
 * Usage: npx tsx scripts/devnet-setup.ts
 */
import fs from 'fs';
import path from 'path';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createFungible,
  mintV1,
  mplTokenMetadata,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  keypairIdentity,
  percentAmount,
  some,
  sol,
} from '@metaplex-foundation/umi';
import bs58 from 'bs58';

const RPC = 'https://api.devnet.solana.com';
const KEYPAIR_FILE = path.join(process.cwd(), 'devnet-keypair.json');

async function main() {
  const umi = createUmi(RPC).use(mplTokenMetadata());

  // Load or create the test wallet
  let secret: string;
  if (fs.existsSync(KEYPAIR_FILE)) {
    secret = JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8')).secret;
    console.log('Using existing test wallet.');
  } else {
    const kp = umi.eddsa.generateKeypair();
    secret = bs58.encode(kp.secretKey);
    fs.writeFileSync(KEYPAIR_FILE, JSON.stringify({ secret }, null, 2));
    console.log('Created new test wallet.');
  }
  const kp = umi.eddsa.createKeypairFromSecretKey(bs58.decode(secret));
  umi.use(keypairIdentity(kp));
  console.log('Test wallet:', umi.identity.publicKey.toString());

  // Airdrop devnet SOL if needed
  const balance = await umi.rpc.getBalance(umi.identity.publicKey);
  console.log('Balance:', Number(balance.basisPoints) / 1e9, 'SOL');
  if (Number(balance.basisPoints) < 0.5e9) {
    console.log('Requesting 2 SOL airdrop...');
    try {
      await umi.rpc.airdrop(umi.identity.publicKey, sol(2));
      console.log('Airdrop received.');
    } catch (e) {
      console.error(
        'Airdrop failed (devnet rate limit). Get SOL manually at https://faucet.solana.com for:',
        umi.identity.publicKey.toString(),
      );
      throw e;
    }
  }

  // Create the token (mutable metadata, decimals 6) with the FIXED URI
  const mint = generateSigner(umi);
  console.log('\nCreating token. Mint:', mint.publicKey.toString());
  await createFungible(umi, {
    mint,
    name: 'Chameleon',
    symbol: 'CHMLN',
    uri: 'http://localhost:3000/api/metadata',
    sellerFeeBasisPoints: percentAmount(0),
    decimals: some(6),
  }).sendAndConfirm(umi);

  // Mint 1,000,000 tokens to the test wallet
  console.log('Minting 1,000,000 tokens to the test wallet...');
  await mintV1(umi, {
    mint: mint.publicKey,
    amount: 1_000_000n * 1_000_000n, // 1M tokens, 6 decimals
    tokenOwner: umi.identity.publicKey,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  console.log('\n========================================');
  console.log('DEVNET TEST TOKEN READY!');
  console.log('Mint:', mint.publicKey.toString());
  console.log('Wallet/authority:', umi.identity.publicKey.toString());
  console.log('\nPut in .env:');
  console.log('RPC_URL=https://api.devnet.solana.com');
  console.log('NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com');
  console.log(`NEXT_PUBLIC_MINT_ADDRESS=${mint.publicKey.toString()}`);
  console.log(`UPDATE_AUTHORITY_SECRET=${secret}`);
  console.log('========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
