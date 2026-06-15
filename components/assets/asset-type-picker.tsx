"use client";
// 资产类型选择器:4x2 卡片网格,带 icon + 标题 + 描述
// 录入页用此组件替代 ProFormSelect 走"主类型选择"步骤
import { Card, Tooltip } from "antd";
import {
  IdcardOutlined,
  SafetyCertificateOutlined,
  AuditOutlined,
  TrophyOutlined,
  TeamOutlined,
  FileSearchOutlined,
  CopyrightOutlined,
  MoreOutlined,
  CheckCircleFilled,
  FileTextOutlined   // v1 标书素材库新增
} from "@ant-design/icons";
import type { AssetType } from "@/types/enums";
import { ASSET_TYPE } from "@/types/enums";

type Item = {
  value: AssetType;
  label: string;
  desc: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
};

export const ASSET_TYPE_ITEMS: Item[] = [
  { value: "LICENSE",       label: "营业执照", icon: IdcardOutlined,         desc: "主体/法人" },
  { value: "CERTIFICATE",   label: "资质证书", icon: SafetyCertificateOutlined, desc: "行业许可/等级" },
  { value: "QUALIFICATION", label: "认证体系", icon: AuditOutlined,          desc: "ISO/体系认证" },
  { value: "PERFORMANCE",   label: "业绩证明", icon: TrophyOutlined,         desc: "过往项目合同" },
  { value: "TEAM_MEMBER",   label: "团队成员", icon: TeamOutlined,           desc: "关键人员/简历" },
  { value: "CASE",          label: "项目案例", icon: FileSearchOutlined,    desc: "案例展示" },
  { value: "PATENT",        label: "专利软著", icon: CopyrightOutlined,      desc: "知识产权" },
  { value: "OTHER",         label: "其他",     icon: MoreOutlined,           desc: "自由文本" },
  // v1 标书素材库新增
  { value: "PERSONNEL_CERT", label: "人员证书", icon: SafetyCertificateOutlined, desc: "员工持证/个人证书" },
  { value: "TEMPLATE",        label: "投标模板", icon: FileTextOutlined,         desc: "投标函/报价单/授权书" }
];

type Props = {
  value?: AssetType;
  onChange?: (value: AssetType) => void;
  /** true = 锁定(用于编辑模式) */
  disabled?: boolean;
};

export function AssetTypePicker({ value, onChange, disabled }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12
      }}
    >
      {ASSET_TYPE_ITEMS.map((item) => {
        const active = value === item.value;
        const Icon = item.icon;
        return (
          <Tooltip key={item.value} title={disabled ? "资产类型不可修改" : item.desc} placement="top">
            <Card
              size="small"
              hoverable={!disabled}
              onClick={() => !disabled && onChange?.(item.value)}
              styles={{
                body: { padding: 12 }
              }}
              style={{
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                borderColor: active ? "#1677ff" : undefined,
                background: active ? "#e6f4ff" : undefined,
                transition: "all 0.2s"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
                <Icon style={{ fontSize: 18, color: active ? "#1677ff" : "#666" }} />
                <span style={{ fontWeight: active ? 600 : 500, color: active ? "#1677ff" : "#333", fontSize: 14 }}>
                  {item.label}
                </span>
                {active && (
                  <CheckCircleFilled style={{ position: "absolute", right: 0, top: 0, color: "#1677ff", fontSize: 14 }} />
                )}
              </div>
              <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{item.desc}</div>
            </Card>
          </Tooltip>
        );
      })}
    </div>
  );
}

// 兼容原 enum 顺序
export { ASSET_TYPE };
