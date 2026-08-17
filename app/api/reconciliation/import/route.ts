import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { importBankTransactions, parseStatementFile } from "@/server/services/reconciliation";
import { bankTransactionImportSchema } from "@/lib/validators/reconciliation";
import { ERROR_CODES } from "@/types/errors";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB, 5000 行流水远远够

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const contentType = req.headers.get("content-type") ?? "";

      let rows: Array<Record<string, unknown>>;
      if (contentType.includes("multipart/form-data")) {
        // 文件导入: .xlsx / .csv, 服务端解析
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请上传流水文件", 400);
        }
        if (file.size > MAX_FILE_SIZE) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "文件超过 5MB 上限", 400);
        }
        rows = await parseStatementFile(Buffer.from(await file.arrayBuffer()), file.name);
      } else {
        // 粘贴导入: JSON 数组 或 Excel 复制的表格文本
        const raw = await req.json();
        const input = bankTransactionImportSchema.parse(raw);
        rows = input.rows;
      }

      const data = await importBankTransactions(user, rows);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
