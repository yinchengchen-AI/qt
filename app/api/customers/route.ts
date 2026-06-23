import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listCustomers, createCustomer } from "@/server/services/customer";
import { customerCreateSchema } from "@/lib/validators/customer";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  // status / scale / customerType / industry 接受单值或逗号分隔多值,如 ?status=LEAD,SIGNED
  status: z.string().optional(),
  scale: z.string().optional(),
  customerType: z.string().optional(),
  industry: z.string().optional(),
  // 地区级联 (省/市/区/镇街): 前端 cascader 给的就是 DB label, equals 匹配
  province: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  town: z.string().optional(),
  // 负责人: 精确匹配 user id
  ownerUserId: z.string().optional(),
  // 创建时间范围: ISO 字符串或 yyyy-MM-dd; 单边也行 (只传 from 或只传 to)
  createdAtFrom: z.string().optional(),
  createdAtTo: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = listQuery.parse(Object.fromEntries(url.searchParams));
      const data = await listCustomers(user, params);
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
      const input = customerCreateSchema.parse(body);
      const data = await createCustomer(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
