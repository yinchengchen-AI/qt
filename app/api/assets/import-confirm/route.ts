// POST /api/assets/import-confirm  body: { type, rows: AssetCreateInput[] }
// 任一行 schema 校验失败 → 整批回滚
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { bulkImportAssets } from "@/server/services/asset-import";
import { ASSET_TYPE } from "@/types/enums";
import { assetCreateSchema } from "@/lib/validators/asset";

const body = z.object({
  type: z.enum(ASSET_TYPE),
  rows: z.array(assetCreateSchema).min(1).max(500)
});

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const input = body.parse(await req.json());
    const data = await bulkImportAssets(user, input.type, input.rows);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
