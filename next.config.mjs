/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: '**.mypinata.cloud' },
      { protocol: 'https', hostname: 'ipfs.io' },
      // Our own /ipfs/<cid> proxy (metadata now points here)
      { protocol: 'https', hostname: 'chameleoncoin.fun' },
      { protocol: 'https', hostname: 'www.chameleoncoin.fun' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;
