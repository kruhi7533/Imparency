import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] bg-canvas flex flex-col justify-center items-center px-4 py-16 font-sans">
      <div className="bg-white border border-gray-200/80 rounded-2xl p-8 sm:p-10 max-w-md w-full shadow-[0_8px_30px_rgba(16,24,40,0.06)] text-center space-y-6">
        <div className="w-14 h-14 bg-trust-50 text-trust-600 ring-1 ring-trust-100 rounded-full flex items-center justify-center mx-auto">
          <Compass className="w-6 h-6" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-trust-700">Error 404</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-gray-900">Page not found</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            The page you were looking for doesn&apos;t exist or has moved.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/discover"
            className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            Discover NGOs
          </Link>
          <Link
            href="/"
            className="bg-trust-600 hover:bg-trust-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
