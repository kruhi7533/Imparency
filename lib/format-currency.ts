/** Formats a rupee amount in compact Indian notation: ₹8,400 / ₹2.4L / ₹1.1Cr */
export function formatCompactINR(amount: number): string {
  if (amount >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(1)}Cr`;
  if (amount >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}
