// GET    /api/assets/[id]   详情
// PATCH  /api/assets/[id]   更新
// DELETE /api/assets/[id]   软删
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  getAsset,
  updateAsset,
  softDeleteAsset,
} from "@/server/services/asset";
import { assetUpdateSchema } from "@/lib/validators/asset";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getAsset(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = assetUpdateSchema.parse(body);
      const data = await updateAsset(user, id, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await softDeleteAsset(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
