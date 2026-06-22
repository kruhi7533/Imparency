import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import ProjectClient from "./ProjectClient";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.id, isDeleted: false },
    include: {
      ngo: {
        select: {
          id: true,
          orgName: true,
          healthScore: true,
          causeCategories: true,
        },
      },
      milestones: {
        orderBy: { sequenceOrder: "asc" },
        include: {
          proofs: {
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const raised = Number(project.raisedAmount);
  const target = Number(project.targetAmount);
  const percent = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;

  const donorCount = await prisma.donation.count({
    where: {
      projectId: project.id,
      status: "SUCCESS",
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Cover Banner */}
      <div className="h-80 w-full relative overflow-hidden">
        <img
          src={project.coverImage}
          alt={project.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/40"></div>
        <div className="absolute bottom-6 left-0 right-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[10px] font-extrabold uppercase tracking-widest bg-emerald-600 text-white px-3 py-1 rounded-full">
            {project.causeCategory}
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-white mt-3 tracking-tight">
            {project.title}
          </h1>
          <p className="text-gray-200 text-sm mt-1">
            📍 {project.location}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">About Campaign</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
                {project.description}
              </p>
            </div>

            {/* Milestones Stepper */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Execution Milestones Sequence</h2>
              
              <div className="relative border-l border-gray-200 dark:border-gray-800 ml-4 space-y-8 pb-4">
                {project.milestones.map((milestone, idx) => {
                  const isCompleted = milestone.status === "COMPLETED" || milestone.status === "VERIFIED";
                  const isPending = milestone.status === "PENDING";
                  const latestProof = milestone.proofs?.[0];
                  return (
                    <div key={milestone.id} className="relative pl-8">
                      {/* Step Indicator Dot */}
                      <span className={`absolute -left-[13px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold border ${
                        isCompleted
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : isPending
                          ? "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-400"
                          : "bg-amber-500 border-amber-500 text-white"
                      }`}>
                        {idx + 1}
                      </span>
                      
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-extrabold text-gray-900 dark:text-white">
                            {milestone.title}
                          </h4>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            isCompleted
                              ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50"
                              : isPending
                              ? "bg-gray-50 dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700"
                              : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50"
                          }`}>
                            {milestone.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {milestone.description}
                        </p>
                        <div className="flex flex-wrap justify-between text-[10px] font-bold text-gray-400 pt-1 pb-1">
                          <span>Target Allocation: ₹{Number(milestone.targetAmount).toLocaleString()}</span>
                          <span>Deadline: {new Date(milestone.deadline).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>

                        {/* Proof of Utilization Inspector */}
                        {latestProof && (
                          <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-800/80 rounded-xl space-y-3.5">
                            <div className="flex items-center justify-between border-b border-gray-200/60 dark:border-gray-800/60 pb-2">
                              <span className="text-[10px] font-extrabold text-gray-450 dark:text-gray-400 uppercase tracking-wider">
                                Proof of Utilization
                              </span>
                              {latestProof.aiValidationScore !== null && (
                                <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${
                                  latestProof.aiValidationScore >= 70
                                    ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-150 dark:border-emerald-900/30"
                                    : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-150 dark:border-amber-900/30"
                                }`}>
                                  AI Audit: {latestProof.aiValidationScore}/100
                                </span>
                              )}
                            </div>

                            {/* NGO Description */}
                            <div className="space-y-1">
                              <span className="text-[9px] font-extrabold text-gray-400 block uppercase tracking-wider">NGO Submission Note:</span>
                              <p className="text-xs text-gray-700 dark:text-gray-300 italic">
                                "{latestProof.description}"
                              </p>
                            </div>

                            {/* Attachments */}
                            {((latestProof.mediaUrls && latestProof.mediaUrls.length > 0) || 
                              (latestProof.documentUrls && latestProof.documentUrls.length > 0)) && (
                              <div className="space-y-1.5">
                                <span className="text-[9px] font-extrabold text-gray-400 block uppercase tracking-wider">Attached Evidence:</span>
                                <div className="flex flex-wrap gap-2">
                                  {/* Media (Images) */}
                                  {latestProof.mediaUrls?.map((url, i) => (
                                    <a
                                      key={url}
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="group block relative w-16 h-16 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden hover:scale-105 transition shadow-sm"
                                    >
                                      <img
                                        src={url}
                                        alt={`Evidence ${i + 1}`}
                                        className="w-full h-full object-cover"
                                      />
                                      <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-[10px] text-white font-bold">
                                        View
                                      </div>
                                    </a>
                                  ))}
                                  
                                  {/* Documents (PDFs, etc) */}
                                  {latestProof.documentUrls?.map((url, i) => {
                                    const fileName = url.split('/').pop() || `Document ${i + 1}`;
                                    return (
                                      <a
                                        key={url}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 rounded-xl text-[10px] text-gray-600 dark:text-gray-400 font-bold shadow-sm transition max-w-[200px]"
                                      >
                                        <span className="text-xs">📄</span>
                                        <span className="truncate">{fileName}</span>
                                      </a>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* AI Verification Feedback */}
                            {latestProof.aiValidationResult && (
                              <details className="group border border-gray-200/70 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-950">
                                <summary className="flex items-center justify-between px-3 py-2 cursor-pointer select-none text-[9px] font-extrabold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/50 uppercase tracking-wider">
                                  <span>🤖 Gemini AI Validation Report</span>
                                  <span className="text-xs group-open:rotate-180 transition-transform">▼</span>
                                </summary>
                                <div className="px-3 py-2.5 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap font-mono">
                                  {latestProof.aiValidationResult}
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-6">
              
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Campaign Progress</h3>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    ₹{raised.toLocaleString()}
                  </span>
                  <span className="text-xs text-gray-400 font-semibold">
                    raised of ₹{target.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] font-bold text-gray-400 mt-2">
                  <span>{percent}% Funded</span>
                  <span>{donorCount} Donors</span>
                </div>
              </div>

              <ProjectClient projectId={project.id} projectTitle={project.title} />
              
            </div>

            {/* NGO info card */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Organized By</h3>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-600 text-white rounded-xl flex items-center justify-center font-black text-lg shadow-sm">
                  {project.ngo.orgName.charAt(0)}
                </div>
                <div>
                  <Link href={`/ngo/${project.ngo.id}`} className="text-sm font-extrabold text-gray-900 dark:text-white hover:text-emerald-600 transition block">
                    {project.ngo.orgName}
                  </Link>
                  {project.ngo.healthScore !== null && project.ngo.healthScore !== undefined ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-block bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50 mt-1">
                      Health Score: {Number(project.ngo.healthScore).toFixed(0)}/100
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-block bg-gray-50 dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 mt-1">
                      New NGO — Score Pending
                    </span>
                  )}
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>

      {/* Mobile spacer to prevent sticky bottom bar overlap */}
      <div className="h-20 lg:hidden"></div>
    </div>
  );
}
