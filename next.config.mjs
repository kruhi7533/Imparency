/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverExternalPackages: ["@react-pdf/renderer"],
  },
};

export default nextConfig;
