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

/**
 * The part of the CSP that is ENFORCED now. These directives cannot break a
 * page that works: nothing here embeds plugins, rewrites <base>, or wants to be
 * framed. The full policy above stays Report-Only until it has been watched in
 * a browser (see the note above). `form-action` is deliberately not enforced:
 * Chrome applies it to redirects after a form post, which would break the
 * Google sign-in hand-off.
 */
const CSP_ENFORCED = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"].join("; ");

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
  // Deny what the app does not use; allow only our own origin for what it does.
  // geolocation=() used to block the field app's GPS on our OWN origin, so every
  // capture was recorded as NO_GPS_DATA and failed the location check. Camera is
  // for field capture; payment for Razorpay checkout (which runs in its frame).
  {
    key: "Permissions-Policy",
    value:
      'camera=(self), microphone=(), geolocation=(self), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=(), interest-cohort=()',
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: CSP_ENFORCED },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfjs-dist and tesseract.js must stay external: webpack does not emit
    // their worker entrypoints into .next/server, so bundling them makes CSR
    // document parsing fail with "Setting up fake worker failed".
    serverComponentsExternalPackages: ["@react-pdf/renderer", "@google/genai", "firebase-admin", "@napi-rs/canvas", "pdfjs-dist", "tesseract.js"],
    optimizePackageImports: ["lucide-react", "framer-motion", "react-icons"],
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
