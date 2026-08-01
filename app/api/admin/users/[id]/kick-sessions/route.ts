import { NextRequest } from "next/server";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { ok, err } from "@/lib/api";
import { kickUserSessions } from "@/server/services/user";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      // 强 ADMIN 才能踢 (与 USER.UPDATE 同源, 不用单加权限)
      requirePermission(user.roleCode, RESOURCE.USER, ACTION.UPDATE);
      const { id } = await ctx.params;
      const data = await kickUserSessions(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
