import { execSync } from 'child_process';

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
    // pdfjs-dist and tesseract.js must stay external: webpack does not emit
    // their worker entrypoints into .next/server, so bundling them makes CSR
    // document parsing fail with "Setting up fake worker failed".
    serverComponentsExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin", "@napi-rs/canvas", "pdfjs-dist", "tesseract.js"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
