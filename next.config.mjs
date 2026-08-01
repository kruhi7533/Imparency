import { execSync } from 'child_process';

if (process.env.NODE_ENV === 'production') {
  try {
    execSync('node scripts/generate-pitch.js', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Pitch deck generation failed during build:', e.message);
  }
}

/**
 * Content-Security-Policy sources, kept as named groups so it's obvious *why*
 * each third party is allowed and what breaks if one is removed.
 *
 * Shipped as Report-Only on purpose: a blocking CSP that is even slightly wrong
 * takes down checkout. Watch the browser console (and any report collector you
 * point `report-uri` at) until violations are quiet, then rename the header to
 * `Content-Security-Policy` to start enforcing.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // 'unsafe-inline'/'unsafe-eval' are required by the Next.js runtime; Razorpay
  // injects the checkout script, Google powers OAuth + FCM.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.google.com https://*.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  // Cloudinary + S3 serve NGO logos, campaign covers and milestone evidence.
  "img-src 'self' data: blob: https://res.cloudinary.com https://*.amazonaws.com https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.razorpay.com https://*.googleapis.com https://*.google.com https://res.cloudinary.com",
  // Razorpay renders its checkout inside an iframe on our page.
  "frame-src 'self' https://*.razorpay.com https://*.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Belt-and-braces with X-Frame-Options below, for browsers that honour both.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // Force HTTPS for two years, including subdomains. Safe here because the app
  // is only ever served over TLS (Vercel).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Nobody may frame us — the app moves money, so clickjacking is a real risk.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers guessing MIME types on uploaded NGO documents.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak donation/project URLs (which contain ids) to third-party sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app needs none of these; denying them limits the blast radius of XSS.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
