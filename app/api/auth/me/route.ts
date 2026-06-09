import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ok } from "@/lib/api";

export async function GET() {
  const session = await getServerSession(authOptions);
  return ok({ user: session?.user ?? null });
}
