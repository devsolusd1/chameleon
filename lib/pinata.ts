/**
 * Optional Pinata (IPFS) mode: when PINATA_JWT is set, each change uploads
 * the image + metadata JSON to IPFS and the on-chain URI is updated to the
 * new CID. The fixed website lives INSIDE the JSON (external_url/website).
 */
const PINATA_JWT = process.env.PINATA_JWT || '';
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';

export function pinataEnabled(): boolean {
  return PINATA_JWT.length > 0;
}

export async function pinFile(buffer: Buffer, filename: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Pinata file upload failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { IpfsHash: string };
  return `https://${PINATA_GATEWAY}/ipfs/${data.IpfsHash}`;
}

export async function pinJson(content: unknown, name: string): Promise<string> {
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: { name } }),
  });
  if (!res.ok) {
    throw new Error(`Pinata JSON upload failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { IpfsHash: string };
  return `https://${PINATA_GATEWAY}/ipfs/${data.IpfsHash}`;
}
