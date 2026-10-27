import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle, MapPin, Building, Target, Heart } from "lucide-react";
import ProjectCoverImage from "@/app/components/ProjectCoverImage";

export default async function PublicNGOProfilePage({ params }: { params: { id: string } }) {
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: params.id },
    include: {
      projects: {
        where: { isDeleted: false, status: { in: ["ACTIVE", "COMPLETED"] } },
        orderBy: { createdAt: "desc" },
        include: {
          milestones: {
            include: {
              proofs: true
            }
          }
        }
      }
    }
  });

  if (!ngo) {
    notFound();
  }

  // Calculate stats
  const activeProjectsCount = ngo.projects.filter(p => p.status === "ACTIVE").length;
  const totalRaised = ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
  
  // Extract images for impact gallery
  const galleryImages: string[] = [];
  ngo.projects.forEach(project => {
    project.milestones.forEach(milestone => {
      milestone.proofs.forEach(proof => {
        if (proof.mediaUrls && proof.mediaUrls.length > 0) {
          galleryImages.push(...proof.mediaUrls);
        }
      });
    });
  });

  // Share of this NGO's milestones whose proof a human has verified — the
  // figure behind the "verified impact" bar. Was a hard-coded "100%".
  const allMilestones = ngo.projects.flatMap((p) => p.milestones);
  const verifiedMilestones = allMilestones.filter((m) => m.status === "VERIFIED" || m.status === "COMPLETED").length;
  const verifiedPct = allMilestones.length ? Math.round((verifiedMilestones / allMilestones.length) * 100) : null;

  // Take up to 12 images for the gallery
  const displayImages = galleryImages.slice(0, 12);

  return (
    <div className="pb-20">
      {/* Cover Image */}
      <div className="w-full h-56 md:h-72 relative bg-trust-50 border-b border-trust-100">
        {ngo.cover_image_url ? (
          <Image 
            src={ngo.cover_image_url} 
            alt={`${ngo.orgName} Cover`} 
            fill 
            className="object-cover"
            priority
          />
        ) : (
          <div className="absolute inset-0 bg-trust-50" />
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 relative z-10">
        {/* Header Profile Section */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-6 sm:p-10 border border-gray-200/80 dark:border-gray-800">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            {/* Logo */}
            <div className="w-32 h-32 rounded-2xl bg-white dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] border-4 border-white dark:border-gray-900 flex-shrink-0 flex items-center justify-center overflow-hidden relative">
              {ngo.logo_url ? (
                <Image src={ngo.logo_url} alt={ngo.orgName} fill className="object-contain p-2" />
              ) : (
                <span className="font-display text-4xl font-semibold text-trust-700">
                  {ngo.orgName.charAt(0)}
                </span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 tracking-tight">
                  {ngo.orgName}
                </h1>
                {ngo.verificationStatus === "VERIFIED" && (
                  <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-bold ring-1 ring-emerald-200" title="Verified NGO">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Verified
                  </div>
                )}
              </div>

              <p className="text-gray-600 max-w-3xl leading-relaxed mb-4">
                {ngo.description}
              </p>

              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" /> {ngo.address}
                </div>
                {ngo.foundedYear && (
                  <div className="flex items-center gap-1.5">
                    <Building className="w-4 h-4" /> Est. {ngo.foundedYear}
                  </div>
                )}
                {ngo.causeCategories.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Target className="w-4 h-4" /> {ngo.causeCategories.join(", ")}
                  </div>
                )}
              </div>
            </div>
            
            {/* CTA */}
            <div className="flex-shrink-0 w-full sm:w-auto mt-4 sm:mt-0">
              <button className="w-full sm:w-auto bg-trust-600 hover:bg-trust-700 text-white font-semibold py-3 px-6 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2">
                <Heart className="w-5 h-5 fill-white/30" />
                Support Us
              </button>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center">
            <div className="text-3xl font-bold text-gray-900 mb-1">
              ₹{totalRaised.toLocaleString('en-IN')}
            </div>
            <div className="text-sm font-semibold text-gray-600">Total Funds Raised</div>
          </div>
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center">
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {activeProjectsCount}
            </div>
            <div className="text-sm font-semibold text-gray-600">Active Projects</div>
          </div>
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center">
            <div className="text-3xl font-bold mb-1 text-emerald-700">
              {ngo.healthScore ? `${ngo.healthScore}/100` : "TBD"}
            </div>
            <div className="text-sm font-semibold text-gray-600">Health Score</div>
          </div>
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center flex flex-col justify-center items-center">
             <div className="text-sm font-bold text-gray-900 dark:text-white mb-2">
               {verifiedPct === null ? "No milestones yet" : `${verifiedPct}% of milestones verified`}
             </div>
             <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2" role="img" aria-label={verifiedPct === null ? "No milestones yet" : `${verifiedMilestones} of ${allMilestones.length} milestones verified`}>
                <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${verifiedPct ?? 0}%` }}></div>
             </div>
          </div>
        </div>

        {/* Impact Gallery */}
        {displayImages.length > 0 && (
          <div className="mt-12">
            <h2 className="font-display text-2xl font-semibold text-gray-900 mb-6">Impact Gallery</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {displayImages.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-2xl overflow-hidden shadow-sm group">
                  <Image src={url} alt={`Impact Image ${i}`} fill className="object-cover transition duration-500 group-hover:scale-110" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Projects */}
        <div className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-gray-900 mb-6">Our Initiatives</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {ngo.projects.map(project => (
              <div key={project.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:shadow-md transition">
                <div className="h-48 relative">
                  <ProjectCoverImage src={project.coverImage || undefined} alt={project.title} causeCategory={project.causeCategory} />
                  <div className="absolute top-4 right-4 bg-white px-3 py-1 rounded-full text-xs font-bold text-gray-900 ring-1 ring-gray-200">
                    {project.status === "ACTIVE" ? (
                      <span className="text-emerald-700">● Active</span>
                    ) : (
                      <span>Completed</span>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">{project.causeCategory}</div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 line-clamp-1">{project.title}</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm line-clamp-2 mb-4">{project.description}</p>
                  
                  <div className="flex justify-between text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    <span>₹{Number(project.raisedAmount).toLocaleString('en-IN')} Raised</span>
                    <span className="text-gray-500 dark:text-gray-400">Goal: ₹{Number(project.targetAmount).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                    <div 
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-1000" 
                      style={{ width: `${Math.min(100, Math.round((Number(project.raisedAmount) / Number(project.targetAmount)) * 100))}%` }} 
                    />
                  </div>
                </div>
              </div>
            ))}
            {ngo.projects.length === 0 && (
              <div className="col-span-2 text-center py-12 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 border-dashed">
                <p className="text-gray-500">No public projects available at the moment.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
