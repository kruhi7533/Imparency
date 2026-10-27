"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Lookup =
  | { state: "INVALID" | "ACCEPTED" | "EXPIRED" | "REVOKED" }
  | { state: "PENDING"; ngoName: string; role: string; roleLabel: string; email: string; hasAccount: boolean; expiresAt: string };

const DEAD: Record<string, { title: string; body: string }> = {
  INVALID: { title: "This invitation link is not valid", body: "Check that you copied the whole link, or ask the NGO to send a new invitation." },
  ACCEPTED: { title: "This invitation has already been used", body: "Each invitation link works once. If that was you, just sign in." },
  EXPIRED: { title: "This invitation has expired", body: "Invitations last 7 days. Ask the NGO to resend it." },
  REVOKED: { title: "This invitation was withdrawn", body: "The NGO cancelled this invitation. Contact them if you think this is a mistake." },
};

export default function InviteAcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/team-invites/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not check the invitation.");
        setLookup(json);
      } catch (e: any) {
        setLoadError(e.message);
      }
    })();
  }, [token]);

  const home = (role: string) => (role === "FIELD_STAFF" ? "/ngo/field" : "/ngo/dashboard");

  async function accept(e?: React.FormEvent) {
    e?.preventDefault();
    if (!lookup || lookup.state !== "PENDING") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team-invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lookup.hasAccount ? { token } : { token, name, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not accept the invitation.");
      if (json.newAccount) {
        const r = await signIn("credentials", { email: lookup.email, password, redirect: false });
        if (r?.error) {
          router.push("/login");
          return;
        }
      } else {
        await update(); // re-read membership into the session now, not in a minute
      }
      router.push(home(json.role));
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  const card = "max-w-md mx-auto bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm p-8";

  if (loadError) return <div className={card} role="alert"><p className="text-sm text-red-600">{loadError}</p></div>;
  if (!lookup) return <div className={card}><p className="text-sm text-gray-500">Checking your invitation…</p></div>;
  if (lookup.state !== "PENDING") {
    const d = DEAD[lookup.state];
    return (
      <div className={card}>
        <h1 className="text-xl font-extrabold text-gray-900 dark:text-white">{d.title}</h1>
        <p className="mt-2 text-sm text-gray-500">{d.body}</p>
        <a href="/login" className="inline-block mt-6 text-sm font-bold text-emerald-700 hover:underline">Go to sign in</a>
      </div>
    );
  }

  const signedInAsInvitee = status === "authenticated" && session?.user?.email?.toLowerCase() === lookup.email;

  return (
    <div className={card}>
      <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">Team invitation</p>
      <h1 className="mt-1 text-xl font-extrabold text-gray-900 dark:text-white">Join {lookup.ngoName}</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        You&apos;ve been invited as <strong>{lookup.roleLabel}</strong> for <strong>{lookup.email}</strong>. This link works once and
        expires on {new Date(lookup.expiresAt).toLocaleDateString("en-IN")}.
      </p>
      {error && <p role="alert" className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</p>}

      {!lookup.hasAccount ? (
        <form onSubmit={accept} className="mt-6 space-y-4">
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
            Your name
            <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
              className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm font-normal bg-white dark:bg-gray-950" />
          </label>
          <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
            Choose a password (at least 8 characters)
            <input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm font-normal bg-white dark:bg-gray-950" />
          </label>
          <button disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
            {busy ? "Joining…" : "Create account and join"}
          </button>
        </form>
      ) : signedInAsInvitee ? (
        <button onClick={() => accept()} disabled={busy} className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
          {busy ? "Joining…" : `Join ${lookup.ngoName}`}
        </button>
      ) : status === "authenticated" ? (
        <div className="mt-6 text-sm text-gray-600 dark:text-gray-400">
          You are signed in as a different account. Sign out, then sign in as {lookup.email}.
          <button onClick={() => signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}` })} className="mt-3 block w-full border border-gray-200 dark:border-gray-700 font-bold py-2.5 rounded-xl">
            Sign out
          </button>
        </div>
      ) : (
        <a href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`} className="mt-6 block text-center w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl">
          Sign in as {lookup.email} to accept
        </a>
      )}
    </div>
  );
}
