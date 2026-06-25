import { DefaultSession, DefaultUser } from "next-auth";
import { JWT as DefaultJWT } from "next-auth/jwt";
import { Role, DonorPersona } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      ngoProfileId: string | null;
      donorPersona: DonorPersona | null;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: Role;
    ngoProfileId: string | null;
    donorPersona: DonorPersona | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: Role;
    ngoProfileId: string | null;
    donorPersona: DonorPersona | null;
  }
}
