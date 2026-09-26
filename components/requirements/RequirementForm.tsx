"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REQUIREMENT_FIELDS, type RequirementFieldKey } from "@/lib/requirements/provenance";
import { SECTOR_OPTIONS, INDIAN_STATES, REPORTING_CADENCES, COMMON_DOCUMENTS } from "@/lib/requirements/form-options";
import { requirementApi } from "./api";

/**
 * Structured CSR requirement form — the primary way to create a requirement.
 * Sections mirror the downloadable template so donors who upload a document
 * and donors who fill the form describe the same things. Submits to
 * POST /api/requirements; the server re-validates everything.
 */

type TextKey = Exclude<RequirementFieldKey, "requiredDocuments">;
type Draft = Record<TextKey, string>;

const EMPTY: Draft = {
  summary: "",
  sector: "",
  state: "",
  district: "",
  budgetMin: "",
  budgetMax: "",
  currency: "INR",
  durationMonths: "",
  expectedBeneficiaries: "",
  primaryKPIs: "",
  secondaryKPIs: "",
  reportingCadence: "",
  timeline: "",
  contactPerson: "",
  contactEmail: "",
  contactPhone: "",
  specialConstraints: "",
};

const REQUIRED = new Set<string>(["title", "summary", "sector", "state"]);

const inputCls =
  "w-full bg-gray-900/70 border border-gray-800 text-sm rounded-lg px-3 py-2 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500";

function Label({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-gray-300 mb-1.5">
      {children}
      {REQUIRED.has(htmlFor.replace("rf-", "")) && <span className="text-emerald-400"> *</span>}
      {hint && <span className="text-gray-500 font-normal"> — {hint}</span>}
    </label>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border border-gray-800 rounded-2xl p-5 bg-gray-950/40">
      <legend className="px-2 text-sm font-bold text-white">
        <span className="text-emerald-400">{n}.</span> {title}
      </legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">{children}</div>
    </fieldset>
  );
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export function RequirementForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [docs, setDocs] = useState<Set<string>>(new Set());
  const [otherDocs, setOtherDocs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const toggleDoc = (doc: string) =>
    setDocs((prev) => {
      const next = new Set(prev);
      next.has(doc) ? next.delete(doc) : next.add(doc);
      return next;
    });

  /** Converts the string draft to API value types; throws a readable message on a bad number. */
  function toValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as TextKey[]) {
      const raw = draft[key].trim();
      const kind = REQUIREMENT_FIELDS[key].kind;
      if (raw === "") values[key] = null;
      else if (kind === "number") {
        const n = Number(raw.replace(/[,₹\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) throw new Error(`${REQUIREMENT_FIELDS[key].label} must be a number.`);
        values[key] = n;
      } else if (kind === "string[]") values[key] = lines(raw);
      else values[key] = raw;
    }
    const documents = [...COMMON_DOCUMENTS.filter((d) => docs.has(d)), ...otherDocs.split(/[\n,]/).map((d) => d.trim()).filter(Boolean)];
    values.requiredDocuments = documents.length ? documents : null;
    return values;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let fields: Record<string, unknown>;
    try {
      fields = toValues();
    } catch (err: any) {
      return setError(err.message);
    }
    setSaving(true);
    try {
      const data = await requirementApi<{ requirement: { id: string } }>("/api/requirements", {
        method: "POST",
        body: JSON.stringify({ title, fields }),
      });
      router.push(`/donor/requirements/${data.requirement.id}?created=1`);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section n={1} title="Programme overview">
        <div className="md:col-span-2">
          <Label htmlFor="rf-title" hint="how this requirement appears in your list">Requirement title</Label>
          <input id="rf-title" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. FY27 Digital Literacy for Government Schools" className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="rf-summary" hint="what you want to fund and why">Executive summary</Label>
          <textarea id="rf-summary" required rows={4} value={draft.summary} onChange={set("summary")} placeholder="Describe the problem, the intervention you want to support, and the target group." className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-sector" hint="pick from the list for the best matches">CSR sector / programme</Label>
          <input id="rf-sector" required list="rf-sector-options" value={draft.sector} onChange={set("sector")} placeholder="e.g. Education" className={inputCls} />
          <datalist id="rf-sector-options">
            {SECTOR_OPTIONS.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div>
          <Label htmlFor="rf-expectedBeneficiaries">Expected beneficiaries</Label>
          <input id="rf-expectedBeneficiaries" inputMode="numeric" value={draft.expectedBeneficiaries} onChange={set("expectedBeneficiaries")} placeholder="e.g. 5000" className={inputCls} />
        </div>
      </Section>

      <Section n={2} title="Location">
        <div>
          <Label htmlFor="rf-state">Target state</Label>
          <input id="rf-state" required list="rf-state-options" value={draft.state} onChange={set("state")} placeholder="e.g. Maharashtra" className={inputCls} />
          <datalist id="rf-state-options">
            {INDIAN_STATES.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div>
          <Label htmlFor="rf-district" hint="optional">Target district</Label>
          <input id="rf-district" value={draft.district} onChange={set("district")} placeholder="e.g. Pune" className={inputCls} />
        </div>
      </Section>

      <Section n={3} title="Budget & timeline">
        <div>
          <Label htmlFor="rf-budgetMin">Minimum budget (₹)</Label>
          <input id="rf-budgetMin" inputMode="numeric" value={draft.budgetMin} onChange={set("budgetMin")} placeholder="e.g. 2500000" className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-budgetMax">Maximum budget (₹)</Label>
          <input id="rf-budgetMax" inputMode="numeric" value={draft.budgetMax} onChange={set("budgetMax")} placeholder="e.g. 5000000" className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-durationMonths">Duration (months)</Label>
          <input id="rf-durationMonths" inputMode="numeric" value={draft.durationMonths} onChange={set("durationMonths")} placeholder="e.g. 12" className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-currency">Currency</Label>
          <input id="rf-currency" value={draft.currency} onChange={set("currency")} className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="rf-timeline" hint="start/end dates or phases">Timeline</Label>
          <input id="rf-timeline" value={draft.timeline} onChange={set("timeline")} placeholder="e.g. April 2027 – March 2028" className={inputCls} />
        </div>
      </Section>

      <Section n={4} title="Outcomes & reporting">
        <div>
          <Label htmlFor="rf-primaryKPIs" hint="one per line">Primary KPIs</Label>
          <textarea id="rf-primaryKPIs" rows={3} value={draft.primaryKPIs} onChange={set("primaryKPIs")} placeholder={"Students trained in digital skills\nSchools with functional computer labs"} className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-secondaryKPIs" hint="one per line, optional">Secondary KPIs</Label>
          <textarea id="rf-secondaryKPIs" rows={3} value={draft.secondaryKPIs} onChange={set("secondaryKPIs")} placeholder="Teacher training sessions held" className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-reportingCadence">Reporting cadence</Label>
          <select id="rf-reportingCadence" value={draft.reportingCadence} onChange={set("reportingCadence")} className={inputCls}>
            <option value="">Not specified</option>
            {REPORTING_CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </Section>

      <Section n={5} title="NGO eligibility & constraints">
        <div className="md:col-span-2">
          <p className="text-xs font-semibold text-gray-300 mb-2">Required documents from the NGO</p>
          <div className="flex flex-wrap gap-2">
            {COMMON_DOCUMENTS.map((doc) => {
              const on = docs.has(doc);
              return (
                <button
                  key={doc}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDoc(doc)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "border-gray-700 text-gray-400 hover:text-white"
                  }`}
                >
                  {on ? "✓ " : "+ "}
                  {doc}
                </button>
              );
            })}
          </div>
          <input aria-label="Other required documents" value={otherDocs} onChange={(e) => setOtherDocs(e.target.value)} placeholder="Other documents, comma separated" className={`${inputCls} mt-3`} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="rf-specialConstraints" hint="optional">Special constraints</Label>
          <textarea id="rf-specialConstraints" rows={3} value={draft.specialConstraints} onChange={set("specialConstraints")} placeholder="e.g. NGO must have 3+ years of operations in the state; no religious or political activity." className={inputCls} />
        </div>
      </Section>

      <Section n={6} title="Contact (never shared with NGOs)">
        <div>
          <Label htmlFor="rf-contactPerson">Contact person</Label>
          <input id="rf-contactPerson" value={draft.contactPerson} onChange={set("contactPerson")} className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-contactEmail">Contact email</Label>
          <input id="rf-contactEmail" type="email" value={draft.contactEmail} onChange={set("contactEmail")} className={inputCls} />
        </div>
        <div>
          <Label htmlFor="rf-contactPhone">Contact phone</Label>
          <input id="rf-contactPhone" type="tel" value={draft.contactPhone} onChange={set("contactPhone")} className={inputCls} />
        </div>
      </Section>

      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-2">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          <span className="text-emerald-400">*</span> required. You can review and edit everything before submitting it for admin verification.
        </p>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 text-gray-950 text-sm font-bold disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create requirement"}
        </button>
      </div>
    </form>
  );
}
