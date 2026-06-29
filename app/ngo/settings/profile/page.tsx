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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-200">
      {/* Decorative background header */}
      <div className="h-64 bg-gradient-to-br from-emerald-900 via-teal-900 to-gray-900 absolute top-0 left-0 right-0 z-0 opacity-80" />
      
      <div className="max-w-5xl mx-auto px-4 py-12 relative z-10">
        <div className="mb-8 pt-8">
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Personal Settings</h2>
          <p className="text-emerald-100/80 mt-2 font-medium">Manage your account preferences and security.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-2xl flex items-center gap-3 text-sm font-bold border border-red-100 dark:border-red-500/30 backdrop-blur-sm shadow-xl">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center gap-3 text-sm font-bold border border-emerald-100 dark:border-emerald-500/30 backdrop-blur-sm shadow-xl">
            <CheckCircle className="w-5 h-5 shrink-0" />
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Avatar & Quick Info */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-xl p-8 flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-emerald-500/10 to-transparent" />
              
              <div className="relative group mb-5 mt-4">
                <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 p-1 shadow-2xl">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full rounded-full object-cover border-4 border-white dark:border-gray-900" />
                  ) : (
                    <div className="w-full h-full rounded-full bg-white dark:bg-gray-900 text-emerald-500 text-5xl font-black flex items-center justify-center">
                      {(name || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                {/* We tie this button to the hidden file input inside the form using htmlFor */}
                <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 w-10 h-10 bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-emerald-500 transition-colors border-4 border-white dark:border-gray-900 cursor-pointer">
                  <Camera className="w-4 h-4" />
                </label>
              </div>

              <h3 className="text-xl font-extrabold text-gray-900 dark:text-white mb-1">{name}</h3>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">{session.user.email}</p>
              
              <div className="px-4 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-widest border border-emerald-100 dark:border-emerald-800/50">
                {session.user.role} Member
              </div>
            </div>

            {/* Account Status Card */}
            <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-xl p-6">
              <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">Security Overview</h4>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 flex items-center justify-center">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">Account Status</div>
                    <div className="text-xs font-medium text-emerald-500">Secured & Verified</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-500 flex items-center justify-center">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">Password</div>
                    <div className="text-xs font-medium text-amber-500">Updated 3 months ago</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Forms */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* General Information Form */}
            <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-xl p-8">
              <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-500" />
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
                    <label className="block text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-widest">
                      Full Name
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-emerald-500 transition-colors">
                        <User className="w-5 h-5" />
                      </div>
                      <input 
                        name="name" 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-2xl pl-12 pr-4 py-3.5 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-widest">
                      Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                        <Mail className="w-5 h-5" />
                      </div>
                      <input 
                        type="email" 
                        value={session.user.email || ""}
                        disabled
                        className="w-full bg-gray-100/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 rounded-2xl pl-12 pr-4 py-3.5 font-medium cursor-not-allowed shadow-sm"
                      />
                    </div>
                    <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mt-2.5 flex items-center gap-1.5">
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
                      className="bg-emerald-600 hover:bg-emerald-500 focus:ring-4 focus:ring-emerald-500/20 disabled:opacity-50 text-white font-black py-3 px-8 rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
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
            <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-xl p-8">
              <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                Notification Preferences
              </h3>
              
              <div className="space-y-4">
                {[
                  { title: "Donation Alerts", desc: "Get notified when a new donation is received." },
                  { title: "Team Activity", desc: "Alerts when team members update projects." },
                  { title: "Monthly Reports", desc: "Receive automated impact summaries via email." }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-100 dark:border-gray-800">
                    <div>
                      <div className="text-sm font-bold text-gray-900 dark:text-white">{item.title}</div>
                      <div className="text-[11px] font-medium text-gray-500 mt-0.5">{item.desc}</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
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
