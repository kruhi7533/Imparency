"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RequirementListItem } from "@/lib/requirements/queries";
import { StatusBadge } from "@/components/requirements/StatusBadge";
import { RequirementForm } from "@/components/requirements/RequirementForm";

const FILTERS: Array<{ key: string; label: string; statuses: string[] | null }> = [
  { key: "all", label: "All", statuses: null },
  { key: "processing", label: "Processing", statuses: ["UPLOADED", "PROCESSING", "FAILED"] },
  { key: "review", label: "Needs Review", statuses: ["AI_EXTRACTED", "DONOR_REVIEW", "NEEDS_CORRECTION"] },
  { key: "admin", label: "Admin Review", statuses: ["PENDING_ADMIN_REVIEW"] },
  { key: "validated", label: "Validated", statuses: ["VALIDATED"] },
  { key: "matching", label: "Matching", statuses: ["MATCHING"] },
  { key: "shortlisted", label: "Shortlisted", statuses: ["SHORTLISTED", "NGO_RESPONSE", "SELECTED"] },
  { key: "contracted", label: "Contracted", statuses: ["CONTRACTED"] },
];

const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const HAS_MATCHES = new Set(["SHORTLISTED", "NGO_RESPONSE", "SELECTED", "CONTRACTED"]);
const ALLOWED_EXT = ["pdf", "docx", "jpg", "jpeg", "png", "webp"];
const TEMPLATE_URL = "/templates/csr-requirement-template.docx";
const TEMPLATE_SECTIONS = [
  { title: "Programme overview", fields: "Requirement title*, Executive summary*, CSR sector*, Expected beneficiaries" },
  { title: "Location", fields: "Target state*, Target district" },
  { title: "Budget & timeline", fields: "Minimum / maximum budget (INR), Currency, Duration (months), Timeline" },
  { title: "Outcomes & reporting", fields: "Primary KPIs, Secondary KPIs, Reporting cadence" },
  { title: "NGO eligibility & constraints", fields: "Required documents (12A, 80G, FCRA…), Special constraints" },
  { title: "Contact", fields: "Contact person, email, phone — never shared with NGOs" },
];

function TemplateLink({ className = "" }: { className?: string }) {
  return (
    <a href={TEMPLATE_URL} download className={`inline-flex items-center gap-1.5 font-semibold text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline ${className}`}>
      ↓ Download template (.docx)
    </a>
  );
}

function ActionLink({ href, children, external = false }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = "px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 text-[11px] font-semibold transition";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export default function RequirementsWorkspaceClient({ items }: { items: RequirementListItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("all");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = FILTERS.find((f) => f.key === filter)!;
  const visible = active.statuses ? items.filter((i) => active.statuses!.includes(i.status)) : items;
  const count = (f: (typeof FILTERS)[number]) => (f.statuses ? items.filter((i) => f.statuses!.includes(i.status)).length : items.length);

  async function upload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.includes(ext)) return setError("Unsupported file format. Please upload PDF, DOCX, PNG, JPG, or WEBP.");
    if (file.size > 10 * 1024 * 1024) return setError("File exceeds the 10MB limit.");

    setError(null);
    setUploading(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/requirements/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      const id = data.requirement?.id ?? data.requirementId;
      if (!res.ok && !id) throw new Error(data.error || "Upload failed.");
      // Even a failed extraction lands on the detail page, where it can be retried.
      router.push(`/donor/requirements/${id}${data.isDuplicate ? "?duplicate=1" : ""}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Upload failed.");
      setUploading(null);
    }
  }

  return (
    <div className="px-6 lg:px-10 py-10 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-extrabold text-white">My CSR Documents</h1>
        {items.length > 0 && (
          <a href="#my-requirements" className="text-xs font-semibold text-gray-400 hover:text-white">
            View your requirements ({items.length}) ↓
          </a>
        )}
      </div>
      <p className="text-sm text-gray-400 mt-2 max-w-2xl">
        Tell us what you want to fund. Fill in the form below — or, if you already have a CSR requirement / RFP document,
        upload it at the bottom of this section.
      </p>

      <div className="mt-6 border border-emerald-500/25 bg-emerald-500/5 rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-sm font-bold text-emerald-200">Uploading a document? Use our template.</p>
            <p className="text-xs text-gray-400 mt-1">
              Documents written in their own format often miss details we need to match NGOs (sector, location, budget, KPIs).
              Follow this format so every field is captured automatically.
            </p>
          </div>
          <TemplateLink className="text-sm" />
        </div>
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">View the template format</summary>
          <ol className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {TEMPLATE_SECTIONS.map((s, i) => (
              <li key={s.title} className="text-xs border border-gray-800 bg-gray-950/40 rounded-lg px-3 py-2">
                <span className="font-bold text-gray-200">
                  {i + 1}. {s.title}
                </span>
                <span className="block text-gray-500 mt-0.5">{s.fields}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-gray-500 mt-2">* required. Keep the headings and field labels as they are in the template.</p>
        </details>
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-bold text-white mb-3">Fill in the requirement form</h2>
        <RequirementForm />
      </section>

      <div className="flex items-center gap-4 my-8" role="separator">
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">or upload a document</span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      <div
        onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.[0]) upload(e.dataTransfer.files[0]);
        }}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition ${
          dragActive ? "border-emerald-500 bg-emerald-500/5" : "border-gray-800 bg-gray-900/30"
        }`}
      >
        {uploading ? (
          <div className="space-y-2">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-emerald-400 mx-auto" />
            <p className="text-sm text-gray-200">Processing “{uploading}”…</p>
            <p className="text-xs text-gray-500">Reading the document and extracting requirements. This can take up to a minute.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-200">Drag & drop a CSR document here, or</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-3 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-sm font-bold transition"
            >
              Choose file
            </button>
            <p className="text-[11px] text-gray-500 mt-3">PDF, DOCX, PNG, JPG, WEBP · max 10MB · stored privately, never shared with NGOs</p>
            <p className="text-xs text-gray-400 mt-2">
              Please follow the standard format — <TemplateLink />
            </p>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-2">{error}</p>}

      <h2 id="my-requirements" className="text-lg font-bold text-white mt-12 scroll-mt-6">Your requirements</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              filter === f.key ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {f.label} <span className="opacity-60">{count(f)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-500 py-10 text-center border border-gray-800 rounded-2xl">
            {items.length === 0 ? "No CSR requirements yet. Fill in the form or upload a document to get started." : "No requirements in this view."}
          </p>
        ) : (
          visible.map((item) => (
            <div key={item.id} className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/donor/requirements/${item.id}`} className="text-sm font-bold text-white hover:text-emerald-300 break-all">
                    {item.fileName}
                  </Link>
                  <StatusBadge status={item.status} />
                  {item.isFormEntry && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">Form entry</span>
                  )}
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">v{item.version}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {[item.sector, item.state].filter(Boolean).join(" · ") || "Requirements not extracted yet"} · {item.isFormEntry ? "Created" : "Uploaded"}{" "}
                  {new Date(item.createdAt).toLocaleDateString("en-IN")} · Updated {new Date(item.updatedAt).toLocaleDateString("en-IN")}
                  {item.matchCount !== null && ` · ${item.matchCount} eligible match${item.matchCount === 1 ? "" : "es"}`}
                  {item.responseCount > 0 && ` · ${item.responseCount} NGO response${item.responseCount === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.hasDocument && PREVIEWABLE.has(item.mimeType) && (
                  <ActionLink href={`/api/requirements/${item.id}/file`} external>
                    Preview
                  </ActionLink>
                )}
                {item.hasDocument && <ActionLink href={`/api/requirements/${item.id}/file?download=1`} external>Download</ActionLink>}
                <ActionLink href={`/donor/requirements/${item.id}?tab=requirements`}>Requirements</ActionLink>
                <ActionLink href={`/donor/requirements/${item.id}?tab=history`}>History</ActionLink>
                {item.status === "VALIDATED" && <ActionLink href={`/donor/requirements/${item.id}?tab=matches`}>Find Matches</ActionLink>}
                {HAS_MATCHES.has(item.status) && <ActionLink href={`/donor/requirements/${item.id}?tab=matches`}>Matches</ActionLink>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
