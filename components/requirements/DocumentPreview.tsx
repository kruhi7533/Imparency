"use client";

import { useState } from "react";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/**
 * Previews the original CSR document through the authenticated file route —
 * the file itself is never publicly addressable. Word documents can't be
 * rendered safely in the browser, so they are offered as a download.
 */
export function DocumentPreview({
  requirementId,
  fileName,
  mimeType,
  hasDocument,
}: {
  requirementId: string;
  fileName: string;
  mimeType: string;
  hasDocument: boolean;
}) {
  const [show, setShow] = useState(false);
  const src = `/api/requirements/${requirementId}/file`;

  if (!hasDocument) {
    return <p className="text-xs text-gray-500">The original document is not available.</p>;
  }

  const canPreview = INLINE.has(mimeType);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canPreview && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 text-xs font-semibold transition"
          >
            {show ? "Hide preview" : "Preview"}
          </button>
        )}
        {canPreview && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 text-xs font-semibold transition"
          >
            Open in new tab
          </a>
        )}
        <a
          href={`${src}?download=1`}
          className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 text-xs font-semibold transition"
        >
          Download
        </a>
      </div>
      {!canPreview && (
        <p className="text-[11px] text-gray-500">In-browser preview isn&apos;t available for this file type ({fileName}); download it instead.</p>
      )}
      {show && canPreview && (
        <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950">
          {mimeType === "application/pdf" ? (
            <iframe src={src} title={`Preview of ${fileName}`} className="w-full h-[70vh]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={`Preview of ${fileName}`} className="max-h-[70vh] mx-auto" />
          )}
        </div>
      )}
    </div>
  );
}
