/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin"],
  },
};

export default nextConfig;
