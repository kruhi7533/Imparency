import { formatCompactINR } from "@/lib/format-currency";

/**
 * Inline-SVG charts for the dashboard. Server-rendered, no dependency, each
 * with role="img" + an aria-label that states the data, and a visually hidden
 * table for screen readers that want the numbers.
 */

export interface MonthBar {
  label: string; // "Oct"
  long: string; // "October 2026"
  a: number; // received & reconciled
  b: number; // awaiting confirmation
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function GroupedBarChart({
  data,
  seriesA,
  seriesB,
}: {
  data: MonthBar[];
  seriesA: string;
  seriesB: string;
}) {
  const W = 640;
  const H = 240;
  const padL = 56;
  const padB = 28;
  const padT = 12;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.a, d.b)), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const group = plotW / Math.max(1, data.length);
  const barW = Math.min(22, group / 3.2);
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const summary = data
    .map((d) => `${d.long}: ${formatCompactINR(Math.round(d.a))} ${seriesA.toLowerCase()}, ${formatCompactINR(Math.round(d.b))} ${seriesB.toLowerCase()}`)
    .join("; ");

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Bar chart by month. ${summary}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">
              {formatCompactINR(Math.round(t))}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + group * i + group / 2;
          return (
            <g key={d.long}>
              <rect x={cx - barW - 2} y={y(d.a)} width={barW} height={Math.max(0, padT + plotH - y(d.a))} rx="4" fill="#1f4bc8">
                <title>{`${d.long} · ${seriesA}: ${formatCompactINR(Math.round(d.a))}`}</title>
              </rect>
              <rect x={cx + 2} y={y(d.b)} width={barW} height={Math.max(0, padT + plotH - y(d.b))} rx="4" fill="#f59e0b">
                <title>{`${d.long} · ${seriesB}: ${formatCompactINR(Math.round(d.b))}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#4b5563">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-trust-600" aria-hidden /> {seriesA}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" aria-hidden /> {seriesB}
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Amounts by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>{seriesA}</th>
            <th>{seriesB}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.long}>
              <td>{d.long}</td>
              <td>{formatCompactINR(Math.round(d.a))}</td>
              <td>{formatCompactINR(Math.round(d.b))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export const DONUT_COLORS = ["#1f4bc8", "#10b981", "#f59e0b", "#8b5cf6", "#0ea5e9", "#9ca3af"];

export function Donut({
  segments,
  centreValue,
  centreLabel,
}: {
  segments: { label: string; value: number }[];
  centreValue: string;
  centreLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const summary = segments.map((s) => `${s.label} ${s.value}`).join(", ");
  return (
    <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={`Donut chart: ${summary}. ${centreValue} ${centreLabel}.`}>
      <circle cx="90" cy="90" r={R} fill="none" stroke="#f3f4f6" strokeWidth="22" />
      {total > 0 &&
        segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.label}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="22"
              strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 90 90)"
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      <text x="90" y="88" textAnchor="middle" fontSize="24" fontWeight="600" fill="#111827">
        {centreValue}
      </text>
      <text x="90" y="108" textAnchor="middle" fontSize="11" fill="#6b7280">
        {centreLabel}
      </text>
    </svg>
  );
}
