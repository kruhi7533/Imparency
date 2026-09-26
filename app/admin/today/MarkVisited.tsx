"use client";

import { useEffect } from "react";

/**
 * Tells the server this admin has now seen Today.
 *
 * Renders nothing. It exists as a client component so the marker only advances
 * when a human actually opened the page — doing it during the server render
 * would also fire on prefetch, quietly consuming "new since you looked" for a
 * visit that never happened.
 *
 * Deliberately does not refresh the page afterwards: the current render is
 * showing what is new, and re-rendering against the advanced marker would
 * empty it in front of the reader.
 */
export default function MarkVisited() {
  useEffect(() => {
    void fetch("/api/admin/today/visit", { method: "POST" }).catch(() => {
      // A missed marker only means the next visit shows a little more than it
      // strictly needed to. Never worth surfacing an error over.
    });
  }, []);

  return null;
}
