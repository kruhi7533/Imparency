import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing email or password");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { ngoProfile: { select: { id: true } } },
        });

        if (!user || !user.passwordHash) {
          throw new Error("No user found with this email");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isPasswordValid) {
          throw new Error("Invalid password");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          ngoProfileId: user.ngoProfile?.id || null,
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
          include: { ngoProfile: { select: { id: true } } },
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
            include: { ngoProfile: { select: { id: true } } },
          });
        } else if (!dbUser.googleId) {
          // Link Google ID if existing email login logs in via Google
          dbUser = await prisma.user.update({
            where: { email: user.email },
            data: { googleId: account.providerAccountId },
            include: { ngoProfile: { select: { id: true } } },
          });
        }

        // Enrich the next-auth user object so JWT callback gets the correct details
        user.id = dbUser.id;
        user.role = dbUser.role;
        user.ngoProfileId = dbUser.ngoProfile?.id || null;
      }
      return true;
    },
    async jwt({ token, user }) {
      // On initial login, user object is provided
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.ngoProfileId = user.ngoProfileId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.ngoProfileId = token.ngoProfileId;
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
