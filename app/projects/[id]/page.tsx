import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import ProjectClient from "./ProjectClient";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";

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
      <Navbar />
      
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
                        <div className="flex flex-wrap justify-between text-[10px] font-bold text-gray-400 pt-1">
                          <span>Target Allocation: ₹{Number(milestone.targetAmount).toLocaleString()}</span>
                          <span>Deadline: {new Date(milestone.deadline).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
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
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-block bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50 mt-1">
                    Health Score: {Number(project.ngo.healthScore).toFixed(0)}/100
                  </span>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
