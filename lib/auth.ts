// NextAuth v4 配置（JWT + Credentials；不挂 PrismaAdapter，简化 P0 阶段）
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { ROLE_PERMISSIONS, type Action, type Resource } from "./permissions";
import type { RoleCode } from "@/types/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      employeeNo: string;
      name: string;
      email: string;
      roleCode: RoleCode;
      permissions: { resource: Resource; actions: Action[] }[];
    };
  }
  interface User {
    id: string;
    employeeNo: string;
    name: string;
    email: string;
    roleCode: RoleCode;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    employeeNo: string;
    roleCode: RoleCode;
  }
}

export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        employeeNo: { label: "工号", type: "text" },
        password: { label: "密码", type: "password" }
      },
      async authorize(creds) {
        if (!creds?.employeeNo || !creds?.password) return null;
        const user = await prisma.user.findFirst({
          where: { employeeNo: creds.employeeNo, deletedAt: null, status: "ACTIVE" },
          include: { role: true }
        });
        if (!user) return null;
        const ok = await bcrypt.compare(creds.password, user.passwordHash);
        if (!ok) return null;
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return {
          id: user.id,
          employeeNo: user.employeeNo,
          name: user.name,
          email: user.email,
          roleCode: user.role.code as RoleCode
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.employeeNo = user.employeeNo;
        token.roleCode = user.roleCode;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid,
        employeeNo: token.employeeNo,
        name: session.user?.name ?? "",
        email: session.user?.email ?? "",
        roleCode: token.roleCode,
        permissions: ROLE_PERMISSIONS[token.roleCode]
      };
      return session;
    }
  },
  secret: process.env.NEXTAUTH_SECRET
};
