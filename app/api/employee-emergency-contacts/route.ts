import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { createEmployeeEmergencyContact, listEmployeeEmergencyContacts } from "@/server/services/employee-emergency-contact";
import { employeeEmergencyContactCreateSchema } from "@/lib/validators/employee-emergency-contact";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const url = new URL(req.url);
      const profileId = url.searchParams.get("profileId");
      if (!profileId) return ok({ data: [] });
      return ok({ data: await listEmployeeEmergencyContacts(actor, profileId) });
    } catch (e) { return err(e); }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const body = await req.json();
      const input = employeeEmergencyContactCreateSchema.parse(body);
      return ok({ data: await createEmployeeEmergencyContact(actor, input) });
    } catch (e) { return err(e); }
  });
}
