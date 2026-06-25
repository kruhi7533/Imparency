/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin"],
  },
};

export default nextConfig;
