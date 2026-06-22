import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { forceUnlockStage } from "@/lib/server/workflow/force-unlock";
import { z } from "zod";

const schema = z.object({ stage: z.enum(["DO", "DELIVER"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { roleCode?: string }).roleCode !== "ADMIN") {
    return Response.json({ code: 40301, message: "需要管理员权限" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: 40001, message: "stage 必须为 DO 或 DELIVER" }, { status: 400 });
  }
  try {
    const r = await forceUnlockStage({ projectId: id, stage: parsed.data.stage, operatorId: (session.user as { id: string }).id });
    return Response.json({ code: 0, data: r });
  } catch (e) {
    return Response.json({ code: 50001, message: (e as Error).message }, { status: 500 });
  }
}
