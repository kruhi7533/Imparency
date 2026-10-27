"use client";

import React, { useCallback, useEffect, useState } from "react";

/**
 * DON-018 / NEG-011: the donor's notification switches and what actually
 * happened to each message. WhatsApp is tried first; if it is off or cannot
 * send, the update falls back to email. In-app is always delivered while on.
 */
interface Channels {
  whatsapp: boolean;
  email: boolean;
  inApp: boolean;
}
interface Delivery {
  id: string;
  eventKey: string;
  channel: "IN_APP" | "WHATSAPP" | "EMAIL";
  status: "SENT" | "FAILED" | "OPTED_OUT" | "PROVIDER_NOT_CONFIGURED";
  reason: string | null;
  attempt: number;
  title: string;
  createdAt: string;
}

const CHANNEL_LABEL: Record<Delivery["channel"], string> = { IN_APP: "In-app", WHATSAPP: "WhatsApp", EMAIL: "Email" };
const STATUS_STYLE: Record<Delivery["status"], string> = {
  SENT: "bg-emerald-50 text-emerald-700 border-emerald-100",
  FAILED: "bg-red-50 text-red-700 border-red-100",
  OPTED_OUT: "bg-gray-100 text-gray-600 border-gray-200",
  PROVIDER_NOT_CONFIGURED: "bg-amber-50 text-amber-700 border-amber-100",
};
const STATUS_LABEL: Record<Delivery["status"], string> = {
  SENT: "Sent",
  FAILED: "Failed",
  OPTED_OUT: "Opted out",
  PROVIDER_NOT_CONFIGURED: "Not available",
};

export default function NotificationPreferencesPanel() {
  const [loading, setLoading] = useState(true);
  const [projectUpdates, setProjectUpdates] = useState(true);
  const [channels, setChannels] = useState<Channels>({ whatsapp: true, email: true, inApp: true });
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, d] = await Promise.all([
        fetch("/api/donor/notification-preferences").then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch("/api/donor/notification-deliveries?limit=20").then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      ]);
      if (!p.ok) throw new Error(p.j.error || "Could not load preferences");
      setProjectUpdates(p.j.projectUpdates);
      setChannels(p.j.channels);
      if (d.ok) setDeliveries(d.j.deliveries);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: { projectUpdates?: boolean; channels?: Partial<Channels> }) => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/donor/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save your preference");
      setProjectUpdates(data.projectUpdates);
      setChannels(data.channels);
      setSaved("Saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof Channels, label: string, hint: string) => (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1 accent-trust-600"
        checked={channels[key]}
        disabled={saving || loading}
        onChange={(e) => save({ channels: { [key]: e.target.checked } })}
      />
      <span>
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <section id="notifications" className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
      <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
        <p className="mt-1 text-xs text-gray-500">
          Milestone and field updates for projects you fund. WhatsApp is tried first; if it is off or cannot be
          delivered, we fall back to email. In-app notifications appear in the bell.
        </p>
        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <label className="flex items-start gap-3 py-2 cursor-pointer border-b border-gray-100">
                <input
                  type="checkbox"
                  className="mt-1 accent-trust-600"
                  checked={projectUpdates}
                  disabled={saving}
                  onChange={(e) => save({ projectUpdates: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">Project updates</span>
                  <span className="block text-xs text-gray-500">Off silences all channels; funded-project pages still show everything.</span>
                </span>
              </label>
              {toggle("whatsapp", "WhatsApp", "Preferred channel, to the phone number on your profile.")}
              {toggle("email", "Email", "Used when WhatsApp is off or cannot be delivered.")}
              {toggle("inApp", "In-app", "Shown in the notification bell.")}
              <p role="status" aria-live="polite" className="mt-2 text-xs">
                {error && <span className="text-red-600">{error}</span>}
                {saved && !error && <span className="text-emerald-600">{saved}</span>}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">Recent deliveries</h3>
              {deliveries.length === 0 ? (
                <p className="mt-2 text-xs text-gray-500">No notifications sent to you yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-gray-100">
                  {deliveries.map((d) => (
                    <li key={d.id} className="py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-800">{CHANNEL_LABEL[d.channel]}</span>
                        <span className={`rounded border px-1.5 py-0.5 font-semibold ${STATUS_STYLE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                        <span className="text-gray-500">{new Date(d.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-0.5 text-gray-600">{d.title}</div>
                      {d.reason && <div className="text-gray-500">{d.reason}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
