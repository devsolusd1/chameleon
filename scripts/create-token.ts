/**
 * Creates the token via Meteora DBC (Dynamic Bonding Curve) with MUTABLE metadata.
 *
 * The key detail is `tokenAuthorityOption: CreatorUpdateAuthority`, which keeps
 * the creator wallet (CREATOR_SECRET) as the metadata update authority — the
 * same key the website uses (UPDATE_AUTHORITY_SECRET) to apply the changes.
 *
 * Usage:
 *   1. Fill in .env: CREATOR_SECRET (base58), RPC_URL, TOKEN_NAME,
 *      TOKEN_SYMBOL and NEXT_PUBLIC_BASE_URL (the site's public URL).
 *   2. npm run create-token
 *   3. Copy the printed mint into NEXT_PUBLIC_MINT_ADDRESS in .env.
 */
import 'dotenv/config';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  DynamicBondingCurveClient,
  buildCurveWithMarketCap,
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import bs58 from 'bs58';

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function main() {
  const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const secret = process.env.CREATOR_SECRET;
  if (!secret) throw new Error('Set CREATOR_SECRET in .env (base58 key of the creator wallet).');

  const name = process.env.TOKEN_NAME || 'Chameleon';
  const symbol = process.env.TOKEN_SYMBOL || 'CHMLN';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  // FIXED URI: the JSON content changes, but this address never does.
  const uri = `${baseUrl}/api/metadata`;

  const payer = Keypair.fromSecretKey(bs58.decode(secret));
  const connection = new Connection(rpc, 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  console.log('Creator / update authority:', payer.publicKey.toBase58());
  console.log('Token:', name, `($${symbol})`);
  console.log('Fixed metadata URI:', uri);

  // ----- 1. Curve config (tweak the market caps, in SOL, to your liking) -----
  const curveConfig = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken, // classic SPL (required for Metaplex metadata)
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE,
      // >>> MUTABLE METADATA: the creator stays as the update authority <<<
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 200,
          endingFeeBps: 200,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Slot,
    initialMarketCap: 20,
    migrationMarketCap: 400,
  });

  const configKeypair = Keypair.generate();
  console.log('\nCreating curve config:', configKeypair.publicKey.toBase58());

  const createConfigTx = await client.partner.createConfig({
    ...curveConfig,
    config: configKeypair.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    quoteMint: SOL_MINT,
    payer: payer.publicKey,
  });

  const configSig = await sendAndConfirmTransaction(
    connection,
    createConfigTx,
    [payer, configKeypair],
    { commitment: 'confirmed' },
  );
  console.log('Config created:', configSig);

  // ----- 2. Pool + token creation -----
  const baseMintKeypair = Keypair.generate();
  console.log('\nCreating pool + token. Mint:', baseMintKeypair.publicKey.toBase58());

  const createPoolTx = await client.creator.createPool({
    baseMint: baseMintKeypair.publicKey,
    config: configKeypair.publicKey,
    name,
    symbol,
    uri,
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
  });

  const poolSig = await sendAndConfirmTransaction(
    connection,
    createPoolTx,
    [payer, baseMintKeypair],
    { commitment: 'confirmed' },
  );
  console.log('Pool created:', poolSig);

  console.log('\n========================================');
  console.log('TOKEN CREATED SUCCESSFULLY!');
  console.log('Mint:', baseMintKeypair.publicKey.toBase58());
  console.log('Config:', configKeypair.publicKey.toBase58());
  console.log('\nNow fill in .env:');
  console.log(`NEXT_PUBLIC_MINT_ADDRESS=${baseMintKeypair.publicKey.toBase58()}`);
  console.log('UPDATE_AUTHORITY_SECRET=<same key as CREATOR_SECRET>');
  console.log('========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
