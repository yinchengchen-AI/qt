import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { markAllRead } from "@/server/services/message";

export async function POST() {
  try {
    const user = await requireSession();
    const data = await markAllRead(user);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
