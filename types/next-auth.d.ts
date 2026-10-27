import { DefaultSession, DefaultUser } from "next-auth";
import { JWT as DefaultJWT } from "next-auth/jwt";
import { Role, DonorPersona, AdminRole, TeamRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      ngoProfileId: string | null;
      donorPersona: DonorPersona | null;
      /** Admin sub-role (lib/admin-roles.ts); null on an ADMIN = SUPER. */
      adminRole?: AdminRole | null;
      /** The caller's role on their NGO (owner = OWNER); null for non-NGO users. */
      ngoTeamRole?: TeamRole | null;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: Role;
    ngoProfileId: string | null;
    donorPersona: DonorPersona | null;
    avatar?: string | null;
    adminRole?: AdminRole | null;
    ngoTeamRole?: TeamRole | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: Role;
    ngoProfileId: string | null;
    donorPersona: DonorPersona | null;
    adminRole?: AdminRole | null;
    ngoTeamRole?: TeamRole | null;
    /** ms epoch of the last DB re-read of role/adminRole (lib/auth.ts jwt callback). */
    rolesCheckedAt?: number;
  }
}
