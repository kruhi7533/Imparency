/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
