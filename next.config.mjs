import { execSync } from 'child_process';

if (!process.env.BASE_URL) {
  console.warn('\x1b[33m%s\x1b[0m', '⚠️  WARNING: BASE_URL environment variable is not defined in your .env file.');
  console.warn('\x1b[33m%s\x1b[0m', '   Email links generated for payment approvals will fallback to http://localhost:3000');
  console.warn('\x1b[33m%s\x1b[0m', '   and will not be reachable on mobile/other local network devices.');
} else {
  console.log('\x1b[32m%s\x1b[0m', `✓ BASE_URL configured: ${process.env.BASE_URL}`);
  console.log('\x1b[36m%s\x1b[0m', `  [Mobile Testing Note] For email links to work on mobile:`);
  console.log('\x1b[36m%s\x1b[0m', `  - LAN IP (e.g. http://192.168.1.X:3000): Your phone MUST be on the same Wi-Fi network.`);
  console.log('\x1b[36m%s\x1b[0m', `  - ngrok (e.g. https://xxxx.ngrok-free.app): Ensure ngrok tunnel is running.`);
}

if (process.env.NODE_ENV === 'production') {
  try {
    execSync('node scripts/generate-pitch.js', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Pitch deck generation failed during build:', e.message);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
