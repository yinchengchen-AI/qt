import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { parseDateRangeQuery } from "@/lib/date-range";
import {
  listSnapshots,
  getOrBuildSnapshot,
  regenerateSnapshot,
  getSnapshot,
  type ReportPeriodType,
} from "@/server/services/report";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const PERIOD_TYPES = ["MONTH", "QUARTER", "YEAR", "CUSTOM"] as const;

const getQuery = z.object({
  definitionCode: z.string().optional(),
  periodType: z.enum(PERIOD_TYPES).optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
});

const postBody = z.object({
  code: z.string(),
  periodType: z.enum(PERIOD_TYPES),
  from: z.string().optional(),
  to: z.string().optional(),
  // 如果提供 snapshotId，则表示重新生成该快照
  snapshotId: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = getQuery.parse(Object.fromEntries(url.searchParams));
      const snapshots = await listSnapshots(user, {
        definitionCode: parsed.definitionCode,
        periodType: parsed.periodType as ReportPeriodType | undefined,
        limit: parsed.limit,
      });
      return ok(snapshots);
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
      const parsed = postBody.parse(body);

      if (parsed.snapshotId) {
        const snapshot = await getSnapshot(user, parsed.snapshotId);
        if (snapshot.definition.code !== parsed.code || snapshot.periodType !== parsed.periodType) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_FAILED,
            "snapshotId 与报表类型/周期不匹配",
            400
          );
        }
        const regenerated = await regenerateSnapshot(user, parsed.snapshotId);
        return ok(regenerated);
      }

      const range = parseDateRangeQuery({ from: parsed.from, to: parsed.to });
      const result = await getOrBuildSnapshot(
        user,
        parsed.code,
        parsed.periodType,
        parsed.periodType === "CUSTOM" ? range : undefined
      );
      return ok(result);
    } catch (e) {
      return err(e);
    }
  });
}
