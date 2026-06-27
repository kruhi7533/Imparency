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
