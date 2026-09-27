/** JSON fetch that throws the API's `error` message on failure. */
export async function requirementApi<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data as T;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function formatBudgetRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return min === max ? inr(max) : `${inr(min)} – ${inr(max)}`;
  if (max !== null) return `Up to ${inr(max)}`;
  if (min !== null) return `From ${inr(min)}`;
  return "Not specified";
}
