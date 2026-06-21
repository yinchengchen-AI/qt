// GET  /api/assets          列表
// POST /api/assets          创建
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listAssets, createAsset } from "@/server/services/asset";
import {
  assetListQuerySchema,
  assetCreateSchema,
} from "@/lib/validators/asset";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = assetListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const data = await listAssets(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const body = await req.json();
      const input = assetCreateSchema.parse(body);
      const data = await createAsset(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
