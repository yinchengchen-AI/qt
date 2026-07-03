import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import {
  listReleases,
  createRelease
} from "@/server/services/app-release";
import { appReleaseCreateSchema } from "@/lib/validators/app-release";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = listQuery.parse(Object.fromEntries(url.searchParams));
      const data = await listReleases(user, params);
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
      const input = appReleaseCreateSchema.parse(body);
      const data = await createRelease(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
