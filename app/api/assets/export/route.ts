// GET /api/assets/export?type=...&status=...&q=...  下载 xlsx
// 权限: ASSET.EXPORT (ADMIN + FINANCE), 不能再借 listAssets 的 READ 校验通过
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listAssets, ASSET_EXPORT_COLUMNS } from "@/server/services/asset";
import { exportToXlsx } from "@/lib/excel";
import { assetListQuerySchema } from "@/lib/validators/asset";
import { ASSET_TYPE_MAP, ASSET_STATUS_MAP } from "@/lib/enum-maps";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.EXPORT);
      const url = new URL(req.url);
      const params = assetListQuerySchema.parse({
        ...Object.fromEntries(url.searchParams),
        pageSize: 1000,
        page: 1,
      });
      const data = await listAssets(user, params);
      const rows = (data.list as unknown as Record<string, unknown>[]).map(
        (r) => ({
          ...r,
          type: ASSET_TYPE_MAP[r.type as string] ?? r.type,
          status: ASSET_STATUS_MAP[r.status as string] ?? r.status,
        }),
      );
      const buf = await exportToXlsx(
        rows,
        ASSET_EXPORT_COLUMNS as unknown as Parameters<typeof exportToXlsx>[1],
        `assets-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
