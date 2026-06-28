// 旧 FineUI 22 个服务项目类型 → 新 Dictionary(SERVICE_TYPE) 映射
// 编码规则：顶级 `LEGACY-{ID}`，子级 `LEGACY-{parentID}.{ID}`
// old wins: 重复时旧值覆盖（脚本里用 upsert update 实现）

export const SERVICE_TYPE_LEGACY = {
  1:  { name: "风险管控", parentId: null, sort: 1 },
  2:  { name: "社会化服务", parentId: null, sort: 1 },
  3:  { name: "标准化咨询", parentId: null, sort: 2 },
  4:  { name: "应急预案", parentId: null, sort: 4 },
  5:  { name: "安全生产台账", parentId: null, sort: 5 },
  6:  { name: "标准化换证", parentId: null, sort: 6 },
  7:  { name: "其它", parentId: null, sort: 99 },
  8:  { name: "社会化服务（锦泰）", parentId: 2, sort: 1 },
  9:  { name: "智慧安监", parentId: null, sort: 9 },
  10: { name: "社会化服务（华增）", parentId: 2, sort: 2 },
  11: { name: "危化品专家意见书", parentId: null, sort: 11 },
  12: { name: "风险管控（锦泰）", parentId: 1, sort: 12 },
  13: { name: "安全生产台账（锦泰）", parentId: 5, sort: 13 },
  14: { name: "标准化咨询（锦泰）", parentId: 3, sort: 14 },
  15: { name: "安全生产台账（华增）", parentId: 5, sort: 15 },
  16: { name: "风险管控（华增）", parentId: 1, sort: 16 },
  17: { name: "标准化换证（锦泰）", parentId: 6, sort: 17 },
  18: { name: "危化品专家意见书（锦泰）", parentId: 11, sort: 18 },
  19: { name: "应急预案（锦泰）", parentId: 4, sort: 19 },
  20: { name: "一园一策", parentId: null, sort: 20 },
  21: { name: "安全风险评估", parentId: 7, sort: 21 },
  22: { name: "数据知识产权（国擎盛时）", parentId: null, sort: 22 }
};

/** 旧 ServiceProjectID → 新 Dictionary.code */
export function legacyServiceTypeCode(oldId) {
  const def = SERVICE_TYPE_LEGACY[oldId];
  if (!def) return null;
  return def.parentId == null ? `LEGACY-${oldId}` : `LEGACY-${def.parentId}.${oldId}`;
}

/** 顶级 = def.sort, 子级 = 100 + def.sort */
export function legacyServiceTypeSort(oldId) {
  const def = SERVICE_TYPE_LEGACY[oldId];
  if (!def) return 999;
  return def.parentId == null ? def.sort : 100 + def.sort;
}

export const STATE_TO_CONTRACT_STATUS = {
  "服务中": "EXECUTING",
  "已到期": "EXPIRED",
  "将到期": "EXECUTING",
  "未开始": "DRAFT",
  "": "DRAFT"
};

export const STATE_TO_PROJECT_STATUS = {
  "服务中": "IN_PROGRESS",
  "已到期": "CLOSED",
  "将到期": "IN_PROGRESS",
  "未开始": "PLANNED",
  "": "PLANNED"
};

export const ENABLED_TO_USER_STATUS = {
  0: "DISABLED",
  1: "ACTIVE"
};

export const LEGACY_DEFAULT_PASSWORD = "Reset@2026";
export const IMPORTER_EMPLOYEE_NO = "importer";
