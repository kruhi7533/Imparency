"use client";

import React, { useState } from "react";
import Link from "next/link";

interface Result {
  kind: string;
  id: string;
  title: string;
  sub: string | null;
  href: string;
}

/**
 * The query is POSTed, never put in the URL: admins search by email or PAN,
 * and personal data must not land in URLs, history or logs.
 */
export default function SearchClient() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed.");
      setResults(data.results);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const kinds = results ? Array.from(new Set(results.map((r) => r.kind))) : [];

  return (
    <div className="py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Search</h1>
          <p className="mt-1 text-sm text-gray-500">
            Organisations, donors, projects, CSR requirements and contracts: by name, email, PAN, registration or contract
            number, or an exact id.
          </p>
        </div>
        <form onSubmit={search} role="search" className="flex gap-2">
          <label htmlFor="admin-search" className="sr-only">
            Search
          </label>
          <input
            id="admin-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            minLength={2}
            maxLength={100}
            autoFocus
            placeholder="e.g. Akshar, csr.acme@demo.com, CTR-2026"
            className="flex-1 min-h-[44px] rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900"
          />
          <button
            type="submit"
            disabled={busy || q.trim().length < 2}
            className="min-h-[44px] rounded-lg bg-trust-600 px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div aria-live="polite">
          {results && results.length === 0 && <p className="text-sm text-gray-500">Nothing matches.</p>}
          {kinds.map((kind) => (
            <section key={kind} className="mb-5">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{kind}</h2>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {results!
                  .filter((r) => r.kind === kind)
                  .map((r) => (
                    <li key={r.kind + r.id}>
                      <Link href={r.href} className="block px-4 py-3 hover:bg-gray-50">
                        <span className="block text-sm font-semibold text-gray-900">{r.title}</span>
                        {r.sub && <span className="block text-xs text-gray-500">{r.sub}</span>}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
