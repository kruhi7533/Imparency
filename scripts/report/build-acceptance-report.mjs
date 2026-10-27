// Builds docs/acceptance-report-v3.pdf from scripts/report/acceptance-v3-data.json.
// Usage: node scripts/report/build-acceptance-report.mjs
// Every verdict in the data file must come from an actual test run; this script
// only lays the results out.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const data = JSON.parse(readFileSync(new URL("./acceptance-v3-data.json", import.meta.url), "utf8"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const VERDICTS = ["PASS", "PARTIAL", "FAIL", "NOT BUILT", "NOT RUN", "BLOCKED-EXTERNAL"];
const count = (key) => Object.fromEntries(VERDICTS.map((v) => [v, data.cases.filter((c) => c[key] === v).length]));
const before = count("prior");
const after = count("verdict");

const pill = (v) => `<span class="pill ${v.replace(/[^A-Z]/g, "")}">${esc(v)}</span>`;

const suites = data.suites
  .map((s) => {
    const rows = data.cases.filter((c) => c.suite === s.key);
    const n = (v) => rows.filter((c) => c.verdict === v).length;
    return `
    <h3>${esc(s.title)} (${rows.length}) — PASS ${n("PASS")}${n("PARTIAL") ? `, PARTIAL ${n("PARTIAL")}` : ""}${n("FAIL") ? `, FAIL ${n("FAIL")}` : ""}${n("BLOCKED-EXTERNAL") ? `, BLOCKED-EXTERNAL ${n("BLOCKED-EXTERNAL")}` : ""}</h3>
    <table class="cases">
      <thead><tr><th style="width:9%">ID</th><th style="width:11%">v2 (25 Oct)</th><th style="width:11%">v3 (now)</th><th>Evidence / what was verified</th></tr></thead>
      <tbody>${rows
        .map((c) => `<tr><td class="id">${esc(c.id)}</td><td>${pill(c.prior)}</td><td>${pill(c.verdict)}</td><td>${esc(c.evidence)}</td></tr>`)
        .join("")}</tbody>
    </table>`;
  })
  .join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif; color: #1f2328; font-size: 10.5pt; line-height: 1.45; }
  h1 { font-size: 21pt; margin: 0 0 6pt; border-bottom: 1px solid #d0d7de; padding-bottom: 6pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #d0d7de; padding-bottom: 3pt; }
  h3 { font-size: 11.5pt; margin: 14pt 0 6pt; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 9pt; background: #f6f8fa; padding: 1px 4px; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #d0d7de; padding: 5pt 7pt; vertical-align: top; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  table.summary td:nth-child(n+2), table.summary th:nth-child(n+2) { text-align: center; width: 18%; }
  td.id { font-weight: 600; white-space: nowrap; }
  .pill { display: inline-block; font-size: 8pt; font-weight: 700; padding: 1px 6px; border-radius: 10px; white-space: nowrap; }
  .PASS { background: #dafbe1; color: #116329; } .PARTIAL { background: #fff8c5; color: #7d4e00; }
  .FAIL { background: #ffebe9; color: #a40e26; } .NOTBUILT, .NOTRUN { background: #eaeef2; color: #424a53; }
  .BLOCKEDEXTERNAL { background: #ddf4ff; color: #0550ae; }
  .verdict { font-size: 15pt; font-weight: 700; color: #116329; margin: 4pt 0; }
  .meta { color: #59636e; }
  ul { margin: 4pt 0 4pt 16pt; padding: 0; } li { margin: 2pt 0; }
</style></head><body>
<h1>${esc(data.title)}</h1>
<p><b>Date:</b> ${esc(data.date)} · <b>Branch:</b> <code>${esc(data.branch)}</code> · <b>Commit:</b> <code>${esc(data.commit)}</code><br>
<b>Baseline:</b> ${esc(data.baseline)}<br><b>Method:</b> ${esc(data.method)}</p>

<h2>Verdict</h2>
<p class="verdict">${esc(data.verdict)}</p>
<p>${esc(data.verdictDetail)}</p>

<h2>Outcome — before and after</h2>
<table class="summary"><thead><tr><th>Outcome</th><th>v2 (25 Oct)</th><th>v3 (now)</th></tr></thead><tbody>
${VERDICTS.filter((v) => before[v] || after[v]).map((v) => `<tr><td>${pill(v)}</td><td>${before[v]}</td><td>${after[v]}</td></tr>`).join("")}
<tr><td><b>Total</b></td><td><b>${data.cases.length}</b></td><td><b>${data.cases.length}</b></td></tr></tbody></table>

<h2>Headline defects (P0) — root cause and fix</h2>
<table><thead><tr><th style="width:18%">Defect</th><th>Root cause</th><th>Fix</th></tr></thead><tbody>
${data.defects.map((d) => `<tr><td><b>${esc(d.id)}</b><br>${esc(d.title)}</td><td>${esc(d.cause)}</td><td>${esc(d.fix)}</td></tr>`).join("")}
</tbody></table>

<h2>Previously not built — now implemented</h2>
<ul>${data.built.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>

<h2>Pilot gates</h2>
<table><thead><tr><th>Gate</th><th style="width:16%">v2</th><th style="width:16%">v3</th></tr></thead><tbody>
${data.gates.map((g) => `<tr><td>${esc(g.gate)}</td><td>${pill(g.before)}</td><td>${pill(g.after)}</td></tr>`).join("")}
</tbody></table>

<h2>Test runs executed</h2>
<table><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>
${data.runs.map((r) => `<tr><td>${esc(r.check)}</td><td>${esc(r.result)}</td></tr>`).join("")}
</tbody></table>

<h2>Case-by-case scorecard</h2>
<p class="meta">PASS = the expected result was observed in a real browser against a running app with persisted data
(Playwright test of the same ID). v2 verdicts are copied from the 25 Oct report.</p>
${suites}

<h2>Notes, limits and environment</h2>
<ul>${data.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
</body></html>`;

writeFileSync(new URL("../../docs/acceptance-report-v3.html", import.meta.url), html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: fileURLToPath(new URL("../../docs/acceptance-report-v3.pdf", import.meta.url)),
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-size:8px;color:#59636e;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>${esc(data.title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log("wrote docs/acceptance-report-v3.pdf", { before, after });
