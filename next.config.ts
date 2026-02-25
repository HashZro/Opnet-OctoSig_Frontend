import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Turbopack is the default in Next.js 16; no extra polyfill config needed.
    // opnet and @btc-vision packages are imported dynamically (client-only),
    // so Node.js built-ins are not bundled on the server.
    turbopack: {},
};

export default nextConfig;
