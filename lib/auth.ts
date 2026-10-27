import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { rateLimit, isRateLimited, clearRateLimit } from "@/lib/rate-limiter";

const LOGIN_MAX_FAILURES = 5;
/** How often the JWT re-reads role / admin sub-role / NGO membership from the DB. */
const ROLE_REFRESH_MS = 60_000;

type IdentityRow = {
  role: any;
  adminRole?: any;
  ngoProfile?: { id: string } | null;
  teamMemberships?: { ngoId: string; role: any }[];
};

/**
 * The session-relevant identity of a user. A team member of an NGO acts as
 * role NGO for that NGO (pre-existing behaviour), now with their team role so
 * pages and the field app can tell an owner from a field worker.
 */
export function identityFromUser(u: IdentityRow) {
  const membership = u.teamMemberships && u.teamMemberships.length > 0 ? u.teamMemberships[0] : null;
  const ownsNgo = !!u.ngoProfile?.id;
  const role = membership && u.role !== "ADMIN" ? "NGO" : u.role;
  return {
    role,
    ngoProfileId: u.ngoProfile?.id || membership?.ngoId || null,
    ngoTeamRole: ownsNgo ? "OWNER" : membership?.role ?? null,
    adminRole: u.role === "ADMIN" ? u.adminRole ?? null : null,
  } as { role: any; ngoProfileId: string | null; ngoTeamRole: any; adminRole: any };
}

const IDENTITY_INCLUDE = {
  ngoProfile: { select: { id: true } },
  teamMemberships: { select: { ngoId: true, role: true }, take: 1, orderBy: { createdAt: "asc" as const } },
};
const LOGIN_WINDOW_SECONDS = 900;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing email or password");
        }

        // NextAuth's authorize() doesn't receive a real Fetch Request, just a
        // plain headers object — extract the client IP directly and use the
        // lower-level limiter helpers rather than checkRateLimit() (which
        // expects a Request instance).
        const headers = (req?.headers ?? {}) as Record<string, string | string[] | undefined>;
        const forwardedFor = headers["x-forwarded-for"];
        const ip =
          (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(",")[0]?.trim() ||
          (headers["x-real-ip"] as string) ||
          "unknown";

        // 5 *failed* attempts / 15 minutes per IP+email. Keyed on the email too so
        // one person's typos can't lock out everyone behind the same IP (in local
        // dev every browser is "::1"); successful sign-ins don't count and clear
        // the bucket. The "|email" suffix is relied on by the reset-password route.
        const limitKey = `${ip}|${credentials.email.trim().toLowerCase()}`;
        if (await isRateLimited(limitKey, "auth/login", LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS)) {
          throw new Error("Too many login attempts. Please try again in a few minutes.");
        }
        const recordFailure = () =>
          rateLimit(limitKey, "auth/login", LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS);

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: IDENTITY_INCLUDE,
        });

        if (!user || !user.passwordHash) {
          await recordFailure();
          throw new Error("No user found with this email");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isPasswordValid) {
          await recordFailure();
          throw new Error("Invalid password");
        }

        await clearRateLimit(limitKey, "auth/login");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          ...identityFromUser(user),
          donorPersona: user.donorPersona,
        };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!user.email) return false;

        // Check if user already exists
        let dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          include: IDENTITY_INCLUDE,
        });

        if (!dbUser) {
          // Auto-create user with DONOR role
          dbUser = await prisma.user.create({
            data: {
              email: user.email,
              name: user.name || "Google User",
              avatar: user.image || null,
              googleId: account.providerAccountId,
              role: "DONOR",
              passwordHash: "", // OAuth users don't use credentials password
            },
            include: IDENTITY_INCLUDE,
          });
        } else if (!dbUser.googleId) {
          // Link Google ID if existing email login logs in via Google
          dbUser = await prisma.user.update({
            where: { email: user.email },
            data: { googleId: account.providerAccountId },
            include: IDENTITY_INCLUDE,
          });
        }

        // Enrich the next-auth user object so JWT callback gets the correct details
        user.id = dbUser.id;
        const ident = identityFromUser(dbUser);
        user.role = ident.role;
        user.ngoProfileId = ident.ngoProfileId;
        user.ngoTeamRole = ident.ngoTeamRole;
        user.adminRole = ident.adminRole;
        user.donorPersona = dbUser.donorPersona ?? null;
        user.avatar = dbUser.avatar;
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (trigger === "update") {
        if (session?.name) token.name = session.name;
        if (session?.image) token.image = session.image;
      }
      
      // On initial login, user object is provided
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.ngoProfileId = user.ngoProfileId;
        token.donorPersona = user.donorPersona ?? null;
        token.image = (user as any).avatar || user.image || null;
        token.adminRole = user.adminRole ?? null;
        token.ngoTeamRole = user.ngoTeamRole ?? null;
        token.rolesCheckedAt = Date.now();
      } else if (token.id && (trigger === "update" || !token.rolesCheckedAt || Date.now() - token.rolesCheckedAt > ROLE_REFRESH_MS)) {
        // Re-read role, admin sub-role and NGO membership so a demotion, a
        // removed team member or a revoked admin role takes effect within a
        // minute instead of at the next login. Best-effort: on a DB hiccup the
        // token keeps its previous values and retries on the next call.
        try {
          const fresh = await prisma.user.findUnique({ where: { id: token.id }, include: IDENTITY_INCLUDE });
          if (fresh) {
            const ident = identityFromUser(fresh);
            token.role = ident.role;
            token.ngoProfileId = ident.ngoProfileId;
            token.ngoTeamRole = ident.ngoTeamRole;
            token.adminRole = ident.adminRole;
          }
          token.rolesCheckedAt = Date.now();
        } catch {
          console.warn("[auth] role refresh failed");
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.ngoProfileId = token.ngoProfileId;
        session.user.donorPersona = token.donorPersona ?? null;
        session.user.adminRole = token.adminRole ?? null;
        session.user.ngoTeamRole = token.ngoTeamRole ?? null;
        session.user.image = token.image as string | null | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
