// 消息中心 v2 共享类型
//
// FE / BE 共用: 业务 row / payload / category 列举
// bus.ts 写库时序化为 snake_case JSON(无 type 转换); 前端直接消费。
export type MessageRowPayload = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: { kind: string; id: string } | Record<string, unknown> | null;
  createdAt: string; // ISO 字符串
  readAt: string | null; // null = 未读
  receiverUserId: string;
};

export type UnreadSummary = {
  total: number;
  byCategory: Record<string, number>;
};

export type MessagePreferenceRow = {
  type: string;
  enabled: boolean;
};

export type BatchAction = "markRead" | "delete";

export type ListMessagesResponse = {
  list: MessageRowPayload[];
  nextCursor: string | null;
  page?: number;
  pageSize?: number;
  total?: number;
  unreadCount: number;
};
