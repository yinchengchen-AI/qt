// GET /api/assets/import-template?type=LICENSE  下载 xlsx 模板
import { requireSession } from "@/lib/session";
import { generateImportTemplate } from "@/server/services/asset-import";
import { ApiError, err } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { ASSET_TYPE, type AssetType } from "@/types/enums";

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const type = String(url.searchParams.get("type") ?? "") as AssetType;
    if (!ASSET_TYPE.includes(type)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知资产类型", 400);
    }
    const buf = await generateImportTemplate(user, type);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="asset-template-${type}.xlsx"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    return err(e);
  }
}
