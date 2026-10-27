"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";

interface Result {
  kind: string;
  id: string;
  title: string;
  sub: string;
  href: string;
}

/**
 * The top-bar search. Same endpoint as /admin/search (POST, so an email or PAN
 * typed here never lands in a URL, history or server log), shown as a dropdown.
 * ⌘K / Ctrl+K focuses it from anywhere in the console.
 */
export default function AdminSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: term }),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || "Search failed.");
          setResults([]);
        } else {
          setResults(Array.isArray(data.results) ? data.results : []);
          setActive(-1);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") setError("Search failed.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (r: Result) => {
    setOpen(false);
    setQ("");
    router.push(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      const pick = results[active >= 0 ? active : 0];
      if (pick) {
        e.preventDefault();
        go(pick);
      }
    }
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search the admin console
      </label>
      <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search NGOs, campaigns, contracts, donors…"
        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/80 pl-10 pr-14 text-sm text-gray-900 placeholder:text-gray-500 transition focus:border-trust-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-trust-500/20"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-gray-500 sm:block">
        ⌘K
      </kbd>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {loading && results.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching…
            </p>
          ) : error ? (
            <p className="px-4 py-3 text-sm text-red-700">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-600">No matches for “{q.trim()}”.</p>
          ) : (
            <ul id={`${listId}-list`} role="listbox" aria-label="Search results" className="max-h-96 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li
                  key={`${r.kind}-${r.id}`}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${i === active ? "bg-trust-50" : "hover:bg-gray-50"}`}
                >
                  <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{r.kind}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{r.title}</span>
                    <span className="block truncate text-xs text-gray-500">{r.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <a href="/admin/search" className="block border-t border-gray-100 px-4 py-2.5 text-xs font-semibold text-trust-700 hover:bg-gray-50">
            Open full search →
          </a>
        </div>
      )}
    </div>
  );
}
