import { ok } from "@/lib/api";
import { isDingtalkEnabled } from "@/lib/env";

export async function GET() {
  return ok({ enabled: isDingtalkEnabled() });
}