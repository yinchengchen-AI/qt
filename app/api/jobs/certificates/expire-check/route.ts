// POST /api/jobs/certificates/expire-check
// CRON_SECRET 鉴权(从请求头 x-cron-secret 读取)
import { ok, err } from "@/lib/api";
import { runCertificateExpiryCheck } from "@/server/jobs/certificate-expiry-check";

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response(JSON.stringify({ code: 401, message: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  try {
    const result = await runCertificateExpiryCheck();
    return ok({ data: result });
  } catch (e) {
    return err(e);
  }
}
