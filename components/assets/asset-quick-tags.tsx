"use client";
// 每种 type 的常用标签建议,点击后追加到 ProFormSelect 的 tag input
import { Tag, Space, Typography } from "antd";
import type { AssetType } from "@/types/enums";

const PRESETS: Record<AssetType, string[]> = {
  LICENSE:       ["主体", "核心", "公司", "母子公司"],
  CERTIFICATE:   ["甲级", "乙级", "丙级", "即将到期", "延续中"],
  QUALIFICATION: ["ISO9001", "ISO14001", "ISO45001", "ISO27001", "认证中"],
  PERFORMANCE:   ["重点项目", "行业标杆", "千万级", "百万级", "央企"],
  TEAM_MEMBER:   ["核心人员", "注册安全工程师", "一级建造师", "高级工程师", "外聘专家"],
  CASE:          ["示范", "行业典型", "获奖", "标杆项目"],
  PATENT:        ["发明专利", "实用新型", "软件著作权", "核心"],
  OTHER:         ["待分类"]
};

type Props = {
  type?: AssetType;
  selected: string[];
  onAdd: (tag: string) => void;
};

const { Text } = Typography;

export function QuickTagSuggestions({ type, selected, onAdd }: Props) {
  if (!type) return null;
  const list = PRESETS[type] ?? [];
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Text type="secondary" style={{ fontSize: 12 }}>推荐:</Text>
      <Space size={4} wrap>
        {list.map((t) => {
          const used = selected.includes(t);
          return (
            <Tag.CheckableTag
              key={t}
              checked={used}
              onChange={(checked) => {
                if (checked && !used) onAdd(t);
              }}
              style={{
                cursor: used ? "default" : "pointer",
                opacity: used ? 0.5 : 1
              }}
            >
              {t}
            </Tag.CheckableTag>
          );
        })}
      </Space>
    </div>
  );
}
