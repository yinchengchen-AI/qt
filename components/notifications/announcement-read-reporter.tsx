"use client";
// 公告已读上报: 详情页 mount 时 POST /api/announcements/[id]/read。
// 失败静默 (公告软删/过期/网络错误都不影响阅读)。
import { useEffect } from "react";

export function AnnouncementReadReporter({ id }: { id: string }) {
  useEffect(() => {
    fetch(`/api/announcements/${id}/read`, { method: "POST", credentials: "include" }).catch(() => {});
  }, [id]);
  return null;
}
