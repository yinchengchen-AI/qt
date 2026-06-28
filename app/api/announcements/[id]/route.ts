import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  getAnnouncement,
  updateAnnouncement,
  softDeleteAnnouncement,
} from "@/server/services/announcement";
import { announcementUpdateSchema } from "@/lib/validators/announcement";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getAnnouncement(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = announcementUpdateSchema.parse(body);
      const data = await updateAnnouncement(user, id, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await softDeleteAnnouncement(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
