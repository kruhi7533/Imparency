import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ProfileActions } from "@/components/donor/ProfileActions";
import { redirect } from "next/navigation";

export default async function DonorProfilePage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      panNumber: true,
      phone: true,
      city: true,
      donorPersona: true,
      createdAt: true
    }
  });

  if (!user) {
    redirect("/login");
  }

  const nameInitial = session.user.name ? session.user.name.charAt(0).toUpperCase() : "U";
  const formattedMemberDate = new Date(user.createdAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto text-left">
      
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">My Profile</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your account credentials and personal preferences</p>
      </div>

      {/* Profile Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* Avatar Initial Circle */}
          <div className="w-[60px] h-[60px] rounded-full bg-emerald-600 border border-emerald-500/25 text-white font-black text-2xl flex items-center justify-center select-none shrink-0 shadow-md">
            {nameInitial}
          </div>
          
          <div className="text-center sm:text-left space-y-1.5 w-full">
            <h2 className="text-lg font-bold text-white leading-tight">
              {session.user.name || "Donor"}
            </h2>
            <p className="text-sm text-gray-400">
              {session.user.email}
            </p>
            <p className="text-xs text-gray-550">
              Member since {formattedMemberDate}
            </p>
            
            {user.donorPersona && (
              <div className="pt-1.5">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                  👤 {user.donorPersona.replace("_", " ")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info fields read-only card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4 mb-6">
        {[
          { label: "PAN Number", value: user.panNumber ?? "Not provided" },
          { label: "Phone", value: user.phone ?? "Not provided" },
          { label: "City", value: user.city ?? "Not provided" },
        ].map((field) => (
          <div key={field.label} className="border-b border-gray-850 pb-3 last:border-b-0 last:pb-0">
            <span className="block text-[10px] uppercase font-bold tracking-widest text-gray-500">
              {field.label}
            </span>
            <span className="text-sm text-white font-semibold block mt-1">
              {field.value}
            </span>
          </div>
        ))}
      </div>

      {/* Profile Actions Container */}
      <ProfileActions />

    </div>
  );
}
