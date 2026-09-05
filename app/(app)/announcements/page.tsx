import { redirect } from "next/navigation";

// 公告列表已并入通知中心 (v0.25.0 消息与公告模块重构)
// 原独立管理页 /announcements 保留路径兼容: 直接跳转到 /messages 的「公告」Tab
// (公告详情页 /announcements/[id] 保持独立, 供卡片与消息链接直达)
export default function AnnouncementsPage() {
  redirect("/messages?tab=announcements");
}
