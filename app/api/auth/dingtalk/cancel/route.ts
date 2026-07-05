import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";

// PENDING -> EXPIRED;其他状态静默 200
export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { state?: string };
    const state = body.state;
    if (!state) return ok({ ok: true });
    await prisma.dingtalkLoginCode.updateMany({
      where: { state, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return ok({ ok: true });
  });
}