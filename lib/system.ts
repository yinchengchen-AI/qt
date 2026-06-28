// 系统用户常量：定时任务 / 状态机自动转换 等"非人"行为共用一个稳定 actor。
// 对应 DB User.id = "system"（迁移 20260621_user_is_system 创建，isSystem=true）。
// 用法：
//   - 写 OperationLog / ContractReviewLog 的 actorId / reviewerId
//   - 查询"系统自动"日志时按 SYSTEM_USER_ID 过滤
//
// 安全约束：
//   - 这个用户的 passwordHash 是不合法 bcrypt，登录永远失败
//   - 上层在 requireSession / listAdminUserIds 等处应当过滤 isSystem=true
export const SYSTEM_USER_ID = "system";

// 列表/会话等"面向真实用户"查询应当显式排除系统占位
export const isSystemUser = (userId: string | null | undefined): boolean =>
  userId === SYSTEM_USER_ID;
