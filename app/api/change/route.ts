import { NextResponse } from 'next/server';
import { readState, saveImage, writeState } from '@/lib/store';
import { verifyBurn } from '@/lib/verifyBurn';
import { updateOnChainMetadata } from '@/lib/updateMetadata';
import { pinataEnabled, pinFile, pinJson } from '@/lib/pinata';
import {
  BASE_URL,
  COOLDOWN_SECONDS,
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  MINT_ADDRESS,
  SITE_URL,
} from '@/lib/config';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];

// Prevents two changes from being processed at the same time
let processing = false;

export async function POST(request: Request) {
  if (!MINT_ADDRESS) {
    return NextResponse.json({ error: 'Token is not configured on the server yet.' }, { status: 500 });
  }

  if (processing) {
    return NextResponse.json({ error: 'Another change is being processed. Try again in a moment.' }, { status: 429 });
  }
  processing = true;

  try {
    const form = await request.formData();
    const wallet = String(form.get('wallet') || '').trim();
    const signature = String(form.get('signature') || '').trim();
    const name = String(form.get('name') || '').trim();
    const symbol = String(form.get('symbol') || '').trim().toUpperCase();
    const image = form.get('image');

    // --- Basic validation ---
    if (!wallet || !signature) {
      return NextResponse.json({ error: 'Wallet and burn signature are required.' }, { status: 400 });
    }
    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: `Invalid name (1 to ${MAX_NAME_LENGTH} characters).` }, { status: 400 });
    }
    if (!symbol || symbol.length > MAX_SYMBOL_LENGTH || !/^[A-Z0-9]+$/.test(symbol)) {
      return NextResponse.json(
        { error: `Invalid ticker (1 to ${MAX_SYMBOL_LENGTH} characters, letters and numbers only).` },
        { status: 400 },
      );
    }

    let imageBuffer: Buffer | null = null;
    let imageType: string | null = null;
    if (image instanceof File && image.size > 0) {
      if (!ALLOWED_IMAGE_TYPES.includes(image.type)) {
        return NextResponse.json({ error: 'Image must be PNG, JPEG or GIF.' }, { status: 400 });
      }
      if (image.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'Image too large (2 MB max).' }, { status: 400 });
      }
      imageBuffer = Buffer.from(await image.arrayBuffer());
      imageType = image.type;
    }

    // --- Cooldown ---
    const state = readState();
    const now = Math.floor(Date.now() / 1000);
    const remaining = state.lastChangeTs > 0 ? COOLDOWN_SECONDS - (now - state.lastChangeTs) : 0;
    if (remaining > 0) {
      return NextResponse.json(
        { error: `Cooldown active. Wait ${remaining}s for the next change.` },
        { status: 429 },
      );
    }

    // --- Signature already used? ---
    if (state.usedSignatures.includes(signature)) {
      return NextResponse.json({ error: 'This burn transaction has already been used.' }, { status: 400 });
    }

    // --- On-chain burn verification ---
    const verification = await verifyBurn(signature, wallet);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: 400 });
    }

    // --- Pinata mode: pin image + metadata JSON to IPFS ---
    let imageUrl = state.imageUrl;
    let metadataUri: string | undefined;
    if (pinataEnabled()) {
      if (imageBuffer && imageType) {
        imageUrl = await pinFile(imageBuffer, 'token-image', imageType);
      }
      if (!imageUrl) imageUrl = `${BASE_URL}/api/image`;
      metadataUri = await pinJson(
        {
          name,
          symbol,
          description: state.description,
          image: imageUrl,
          external_url: SITE_URL,
          extensions: { website: SITE_URL },
        },
        `${symbol}-metadata`,
      );
    }

    // --- On-chain update (fixed URI, or the new IPFS URI in Pinata mode) ---
    const updateSignature = await updateOnChainMetadata(name, symbol, metadataUri);

    // --- Persist the new state ---
    const newState = { ...state };
    newState.name = name;
    newState.symbol = symbol;
    newState.imageUrl = imageUrl;
    newState.metadataUri = metadataUri ?? null;
    if (imageBuffer && imageType) {
      newState.imageFile = saveImage(imageBuffer, imageType);
      newState.imageType = imageType;
    }
    newState.lastChangeTs = Math.floor(Date.now() / 1000);
    newState.usedSignatures = [...state.usedSignatures.slice(-500), signature];
    newState.history = [
      ...state.history.slice(-100),
      { name, symbol, wallet, signature, ts: newState.lastChangeTs },
    ];
    writeState(newState);

    return NextResponse.json({
      ok: true,
      name,
      symbol,
      updateSignature,
      explorer: `https://solscan.io/tx/${updateSignature}`,
    });
  } catch (err) {
    console.error('change error:', err);
    const message = err instanceof Error ? err.message : 'Internal error.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    processing = false;
  }
}
