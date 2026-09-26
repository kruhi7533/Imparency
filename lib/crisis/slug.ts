import prisma from "@/lib/prisma";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/** Generates a unique slug for a Crisis Event, appending -2, -3, ... on collision. */
export async function generateUniqueCrisisSlug(title: string): Promise<string> {
  const base = slugify(title) || "crisis-event";
  let candidate = base;
  let suffix = 1;

  while (await prisma.crisisEvent.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}
