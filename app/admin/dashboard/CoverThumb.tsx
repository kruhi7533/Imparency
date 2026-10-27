"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/** A campaign's cover image, falling back to a neutral tile when missing or broken. */
export default function CoverThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gray-100 text-gray-500">
        <ImageOff className="h-5 w-5" aria-hidden />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setFailed(true)} className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />;
}
