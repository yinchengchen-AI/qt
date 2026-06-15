// POST /api/assets/import  body: FormData { type: string, file: File }
// 返回 { parseResult } 不入库;二次 POST /api/assets/import-confirm 走 bulk
import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { parseImportFile } from "@/server/services/asset-import";
import { ASSET_TYPE, type AssetType } from "@/types/enums";

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const form = await req.formData();
    const type = String(form.get("type") ?? "") as AssetType;
    if (!ASSET_TYPE.includes(type)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知资产类型", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未上传文件", 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await parseImportFile(user, type, buf);
    return ok(result);
  } catch (e) {
    return err(e);
  }
}
