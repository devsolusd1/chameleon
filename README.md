# 🦎 Chameleon — the coin that changes its skin

A Solana token created via **Meteora DBC** with **mutable** metadata. Any
holder can burn a % of their own balance to change the token's **name**,
**ticker** and **image** — straight on-chain, with a cooldown between changes.
The website (this project) is the only thing that never changes: the metadata
URI points to `/api/metadata` on this domain forever.

## How it works

1. The token is created by [scripts/create-token.ts](scripts/create-token.ts)
   with `tokenAuthorityOption: CreatorUpdateAuthority` — the creator wallet
   remains the metadata *update authority* (mutable metadata).
2. The holder connects their wallet on the site, fills in name/ticker/image
   and approves a transaction that **burns 1,000,000 tokens** (configurable
   via `BURN_AMOUNT`).
3. The backend verifies the burn on-chain (right mint, right wallet, enough
   burned, recent transaction, never used before) and then:
   - updates `name` and `symbol` on-chain via Metaplex (`updateV1`), keeping
     the URI fixed;
   - swaps the image/JSON served at `/api/image` and `/api/metadata`.
4. A 2-minute cooldown (configurable) until the next change.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
```

### 1. Create the token (one time only)

Fill in `.env`: `CREATOR_SECRET` (base58 key of the wallet that will pay and
remain the update authority), `RPC_URL`, `TOKEN_NAME`, `TOKEN_SYMBOL` and
`NEXT_PUBLIC_BASE_URL` (the site's final public URL — important, since it
becomes the fixed metadata URI!). Then:

```bash
npm run create-token
```

Copy the printed mint into `NEXT_PUBLIC_MINT_ADDRESS` and put the creator's
key into `UPDATE_AUTHORITY_SECRET`.

> Tweak the curve's market caps (initialMarketCap / migrationMarketCap, in
> SOL) inside the script before running it, if you like.

### 2. Run the site

```bash
npm run dev    # development
npm run build && npm start   # production
```

## Environment variables

| Variable | Description |
| --- | --- |
| `RPC_URL` | RPC used by the server (use a paid RPC in production) |
| `UPDATE_AUTHORITY_SECRET` | Base58 key of the update authority (⚠️ secret!) |
| `BURN_AMOUNT` | Tokens to burn per change (default `1000000`) |
| `COOLDOWN_SECONDS` | Cooldown between changes (default `120`) |
| `SITE_URL` | Fixed official website shown in the metadata |
| `NEXT_PUBLIC_RPC_URL` | RPC used by the browser |
| `NEXT_PUBLIC_MINT_ADDRESS` | Token mint |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the site (base of the fixed URI) |
| `PINATA_JWT` | Optional: enables Pinata/IPFS mode (⚠️ secret!) |
| `PINATA_GATEWAY` | Optional: dedicated Pinata gateway domain |

### Pinata (IPFS) mode

If `PINATA_JWT` is set, each change pins the new image and metadata JSON to
IPFS via Pinata and updates the on-chain URI to the new CID (IPFS is
content-addressed, so the URI changes on every edit — the fixed website lives
inside the JSON as `external_url`/`website`). Without `PINATA_JWT`, the site
serves the metadata itself at the fixed URI `NEXT_PUBLIC_BASE_URL/api/metadata`.

## Deployment — IMPORTANT

### Vercel (recommended)

1. Import the GitHub repo in Vercel.
2. Add the **Upstash Redis** integration (Marketplace → Upstash → free plan).
   It injects `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (or
   `KV_REST_API_URL`/`KV_REST_API_TOKEN`) automatically — the app accepts both.
3. Set `PINATA_JWT` (required on Vercel: the filesystem is ephemeral, so
   images must live on IPFS).
4. Add the remaining environment variables from the table above, with
   `SITE_URL` and `NEXT_PUBLIC_BASE_URL` pointing to your production domain.
5. Deploy. Every push to `main` redeploys automatically.

Without Redis configured the app falls back to file storage in `data/`
(local development), which also works on any host with a persistent disk
(VPS, Railway, Render/Fly.io with a volume).

### General notes
- `UPDATE_AUTHORITY_SECRET` is the key that controls the token's metadata.
  Never expose it, never commit it. Use a dedicated wallet just for this,
  holding a small amount of SOL for update fees (~0.000005 SOL per change).
- The metadata URI is `NEXT_PUBLIC_BASE_URL/api/metadata`. If you ever switch
  domains, run an update pointing to the new one (better: don't switch).

## Metadata republish (indexer nudge)

Some trading bots/terminals miss the metadata-update event and keep stale
data. `POST /api/republish` (protected by `REPUBLISH_SECRET`) re-writes the
CURRENT on-chain metadata with identical values — a harmless "touch" that
emits a fresh account-change event for indexers. It shares the change lock
and skips itself whenever the on-chain state differs from the stored state,
so it can never overwrite a real change. A GitHub Actions workflow
([.github/workflows/republish.yml](.github/workflows/republish.yml)) calls it
every ~5 minutes using the `REPUBLISH_SECRET` repository secret.

## Burn flow security

- The burn is verified on-chain via `getParsedTransaction`: a
  `burn`/`burnChecked` instruction of the right mint, authorized by the
  claimed wallet.
- The burned amount must be ≥ `BURN_AMOUNT` whole tokens.
- Transactions older than 15 minutes are rejected and each signature can only
  be used once (anti-replay).
- The cooldown is enforced server-side, not just in the UI.
