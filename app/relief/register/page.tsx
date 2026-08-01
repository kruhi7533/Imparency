"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

const inputClass =
  "w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500";
const labelClass = "block text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-wide";

function RegisterInitiativeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const crisisEventId = searchParams.get("crisisEventId") || "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [organizerName, setOrganizerName] = useState("");
  const [organizerType, setOrganizerType] = useState("INDIVIDUAL");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [requiredFunds, setRequiredFunds] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankProof, setBankProof] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [documents, setDocuments] = useState<File[]>([]);

  if (status === "loading") return null;

  if (!session?.user) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-gray-300">Sign in to register a relief initiative.</p>
          <button
            onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
            className="bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-3 rounded-xl text-sm"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (!crisisEventId) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4 text-center">
        <p className="text-gray-400 max-w-sm">
          Start from an active crisis's page and use "Register an initiative" so we know which emergency this relates to.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!bankProof) {
      setError("A bank proof document (cancelled cheque or passbook photo) is required.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("organizerName", organizerName);
      formData.append("organizerType", organizerType);
      formData.append("description", description);
      formData.append("location", location);
      formData.append("requiredFunds", requiredFunds);
      formData.append("bankAccountName", bankAccountName);
      formData.append("bankAccountNumber", bankAccountNumber);
      formData.append("bankIfsc", bankIfsc);
      formData.append("bankProof", bankProof);
      images.forEach((f) => formData.append("images", f));
      documents.forEach((f) => formData.append("documents", f));

      const res = await fetch(`/api/crisis/${crisisEventId}/initiatives`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit initiative");

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="font-display text-2xl font-semibold">Submitted for review</h1>
          <p className="text-gray-400 text-sm">
            Our team will verify your bank details and documents before this goes live. We'll email you once it's published — or if we need anything else from you.
          </p>
          <button onClick={() => router.push(`/crisis`)} className="text-red-300 hover:text-red-200 font-bold text-sm">
            ← Back to Emergency Relief
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-8 space-y-3">
          <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
            Individual Relief Initiative
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Register your relief effort</h1>
          <p className="text-sm text-gray-400">
            For individuals or informal groups responding on the ground. Every submission is manually verified — including your bank details — before it can accept donations.
          </p>
        </div>

        {error && <div className="mb-6 p-3.5 bg-red-950/30 border border-red-900 rounded-xl text-xs text-red-300">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Your name / organization</label>
              <input className={inputClass} value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select className={inputClass} value={organizerType} onChange={(e) => setOrganizerType(e.target.value)}>
                <option value="INDIVIDUAL">Individual</option>
                <option value="INFORMAL_GROUP">Informal group</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>What are you doing, and why does it need funding?</label>
            <textarea className={inputClass} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Location</label>
              <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>Funds required (₹)</label>
              <input type="number" min={1} className={inputClass} value={requiredFunds} onChange={(e) => setRequiredFunds(e.target.value)} required />
            </div>
          </div>

          <div className="border-t border-gray-800 pt-5">
            <h3 className="font-display text-base font-semibold mb-1">Bank details</h3>
            <p className="text-xs text-gray-500 mb-4">Encrypted at rest, visible only to the verifying admin — never shown publicly.</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelClass}>Account holder name</label>
                <input className={inputClass} value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} required />
              </div>
              <div>
                <label className={labelClass}>IFSC code</label>
                <input className={inputClass} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="ABCD0123456" required />
              </div>
            </div>
            <div className="mb-4">
              <label className={labelClass}>Account number</label>
              <input inputMode="numeric" className={inputClass} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, ""))} required />
            </div>
            <div>
              <label className={labelClass}>Bank proof (cancelled cheque or passbook photo)</label>
              <input type="file" accept="image/*,application/pdf" className={inputClass} onChange={(e) => setBankProof(e.target.files?.[0] || null)} required />
            </div>
          </div>

          <div className="border-t border-gray-800 pt-5">
            <div className="mb-4">
              <label className={labelClass}>Photos (up to 6, optional)</label>
              <input type="file" accept="image/*" multiple className={inputClass} onChange={(e) => setImages(Array.from(e.target.files || []).slice(0, 6))} />
            </div>
            <div>
              <label className={labelClass}>Supporting documents — ID proof, any registration (up to 4, optional)</label>
              <input type="file" multiple className={inputClass} onChange={(e) => setDocuments(Array.from(e.target.files || []).slice(0, 4))} />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-sm transition"
          >
            {loading ? "Submitting…" : "Submit for review"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function RegisterInitiativePage() {
  return (
    <Suspense fallback={null}>
      <RegisterInitiativeForm />
    </Suspense>
  );
}
