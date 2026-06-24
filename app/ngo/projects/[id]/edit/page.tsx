import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import EditProjectClient from "./EditProjectClient";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "NGO") {
    redirect("/login?callbackUrl=/ngo/dashboard");
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id, isDeleted: false },
    include: {
      ngo: {
        select: {
          id: true,
          userId: true,
          verificationStatus: true,
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

  // Ensure this project belongs to the logged-in NGO
  if (project.ngo.userId !== session.user.id) {
    redirect("/unauthorized");
  }

  // Ensure they are verified
  if (project.ngo.verificationStatus !== "VERIFIED") {
    redirect("/unauthorized");
  }

  // Prepare standard JS types from Prisma decimals
  const serializedProject = {
    id: project.id,
    title: project.title,
    description: project.description,
    problem_statement: project.problem_statement || "",
    expected_outcome: project.expected_outcome || "",
    causeCategory: project.causeCategory,
    targetAmount: Number(project.targetAmount),
    raisedAmount: Number(project.raisedAmount),
    location: project.location,
    coverImage: project.coverImage,
    milestones: project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      targetAmount: Number(m.targetAmount).toString(),
      deadline: new Date(m.deadline).toISOString().split("T")[0],
      status: m.status,
    })),
  };

  return <EditProjectClient project={serializedProject} />;
}
