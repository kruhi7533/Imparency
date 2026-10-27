"use client";

import { useTransition, useState, useEffect } from "react";
import { updateUserProfile } from "./actions";
import { User, AlertCircle, CheckCircle, Mail, Shield, Key, Bell, Camera } from "lucide-react";
import { useSession } from "next-auth/react";

export default function NGOUserProfilePage() {
  const { data: session, update } = useSession();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [name, setName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  
  useEffect(() => {
    if (session?.user?.name) {
      setName(session.user.name);
    }
    // Try to load avatar from session if it exists, otherwise it might be empty on first load.
    // In a real app we'd fetch it on load, but for simplicity here we'll just handle updates.
    if ((session?.user as any)?.image) {
      setAvatarPreview((session?.user as any).image);
    }
  }, [session]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const formData = new FormData(e.currentTarget);
    
    startTransition(async () => {
      const result = await updateUserProfile(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess("Profile updated successfully!");
        if (result.avatarUrl) {
          setAvatarPreview(result.avatarUrl);
          await update({ name: formData.get("name"), image: result.avatarUrl });
        } else {
          await update({ name: formData.get("name") });
        }
      }
    });
  };

  if (!session) return null;

  return (
    <div className="relative">
      {/* Decorative background header */}
      
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="mb-8">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 tracking-tight">Personal Settings</h2>
          <p className="text-sm text-gray-600 mt-1">Manage your account preferences and security.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-2xl flex items-center gap-3 text-sm font-semibold border border-red-200">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-3 text-sm font-semibold border border-emerald-200">
            <CheckCircle className="w-5 h-5 shrink-0" />
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Avatar & Quick Info */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-8 flex flex-col items-center text-center relative overflow-hidden">
              
              <div className="relative group mb-5 mt-4">
                <div className="w-32 h-32 rounded-full bg-trust-100 p-1 ring-1 ring-trust-200">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full rounded-full object-cover border-4 border-white dark:border-gray-900" />
                  ) : (
                    <div className="w-full h-full rounded-full bg-white text-trust-700 font-display text-5xl font-semibold flex items-center justify-center">
                      {(name || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                {/* We tie this button to the hidden file input inside the form using htmlFor */}
                <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 w-10 h-10 bg-trust-600 text-white rounded-full flex items-center justify-center shadow-md hover:bg-trust-700 transition-colors border-4 border-white dark:border-gray-900 cursor-pointer">
                  <Camera className="w-4 h-4" />
                </label>
              </div>

              <h3 className="text-xl font-semibold text-gray-900 mb-1">{name}</h3>
              <p className="text-sm font-medium text-gray-600 mb-4">{session.user.email}</p>
              
              <div className="px-4 py-1.5 bg-trust-50 text-trust-700 rounded-full text-xs font-bold uppercase tracking-widest ring-1 ring-trust-200">
                {session.user.role} Member
              </div>
            </div>

            {/* Account Status Card */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-6">
              <h4 className="text-xs font-bold text-gray-500 dark:text-gray-500 uppercase tracking-widest mb-4">Security Overview</h4>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">Account Status</div>
                    <div className="text-xs font-medium text-emerald-700">Secured & Verified</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 flex items-center justify-center">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">Password</div>
                    <div className="text-xs font-medium text-gray-500">Change it any time from the sign-in page via “Forgot password”.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Forms */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* General Information Form */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <User className="w-5 h-5 text-trust-600" />
                General Information
              </h3>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Hidden file input for Avatar */}
                <input 
                  type="file" 
                  id="avatar-upload"
                  name="avatar" 
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setAvatarPreview(URL.createObjectURL(file));
                    }
                  }}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold text-gray-600 mb-2 uppercase tracking-widest">
                      Full Name
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-trust-600 transition-colors">
                        <User className="w-5 h-5" />
                      </div>
                      <input 
                        name="name" 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 rounded-xl pl-12 pr-4 py-3.5 font-medium focus:outline-none focus:ring-2 focus:ring-trust-500/20 focus:border-trust-500 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold text-gray-600 mb-2 uppercase tracking-widest">
                      Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                        <Mail className="w-5 h-5" />
                      </div>
                      <input 
                        type="email" 
                        value={session.user.email || ""}
                        disabled
                        className="w-full bg-gray-50 border border-gray-200 text-gray-600 rounded-xl pl-12 pr-4 py-3.5 font-medium cursor-not-allowed"
                      />
                    </div>
                    <p className="text-[11px] font-medium text-gray-500 dark:text-gray-500 mt-2.5 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Your email address is used for login and cannot be changed here.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-end">
                    <button 
                      type="submit" 
                      disabled={isPending}
                      className="bg-trust-600 hover:bg-trust-700 focus:ring-4 focus:ring-trust-500/20 disabled:opacity-50 text-white font-semibold py-3 px-8 rounded-lg shadow-sm transition-all flex items-center gap-2"
                    >
                      {isPending ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save Changes"
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Notification Preferences (Dummy) */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-700" />
                Notification Preferences
              </h3>
              
              <div className="space-y-4">
                {[
                  { title: "Donation Alerts", desc: "Get notified when a new donation is received." },
                  { title: "Team Activity", desc: "Alerts when team members update projects." },
                  { title: "Monthly Reports", desc: "Receive automated impact summaries via email." }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-200">
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white">{item.title}</div>
                      <div className="text-[11px] font-medium text-gray-500 mt-0.5">{item.desc}</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-trust-600"></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
