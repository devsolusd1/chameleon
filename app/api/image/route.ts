import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readImage, readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = readState();

  if (state.imageFile) {
    const buffer = readImage(state.imageFile);
    if (buffer) {
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': state.imageType || 'image/png',
          'Cache-Control': 'no-store, max-age=0',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  // Default: the chameleon logo, until a holder uploads a new image
  const logo = fs.readFileSync(path.join(process.cwd(), 'public', 'logo.png'));
  return new NextResponse(new Uint8Array(logo), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
