"use client";
import { ProCard } from "@ant-design/pro-components";
import { App as AntdApp, Alert, Button, Input, Space, Tag, Typography } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ErrorBox } from "@/components/callout";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { useGoBack } from "@/lib/navigation";
import { PermissionMatrix, type Permission } from "@/components/admin/permission-matrix";

const { Text } = Typography;

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isSystem: boolean;
  updatedAt: string;
};

export default function EditRolePage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const goBack = useGoBack(`/admin/roles/${id}`);
  const { message } = AntdApp.useApp();
  const { data, error, isLoading, mutate } = useSWR<Role>(`/api/roles/${id}`);

  // 编辑中的本地状态: name / description / permissions
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [perms, setPerms] = useState<Permission[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  // 首次加载后初始化本地状态
  const role = data;
  const basePerms = useMemo(() => role?.permissions ?? [], [role]);
  if (role && !initialized) {
    setName(role.name);
    setDescription(role.description ?? "");
    setPerms(basePerms);
    setInitialized(true);
  }

  // 检测是否有改动
  const dirty =
    !!role &&
    (name !== role.name ||
      description !== (role.description ?? "") ||
      !samePerms(perms, basePerms));

  // ADMIN 角色的硬护栏: 本地状态若违反, 直接禁用保存并标红
  const adminGuardBroken =
    role?.code === "ADMIN" && !adminPermsSafe(perms);

  async function onSave() {
    if (!role) return;
    if (adminGuardBroken) {
      message.error("ADMIN 角色必须保留 [角色] 资源的读+改权限");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        permissions: perms
      };
      const res = await fetch(`/api/roles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (j.code !== 0) {
        message.error(j.message);
        return;
      }
      message.success("角色已保存,权限变更将在 ≤2s 内对全员生效");
      await mutate();
      router.push(`/admin/roles/${id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑角色" />
        <div style={{ marginTop: 12 }}>
          <ErrorBox title="加载失败">{(error as Error).message}</ErrorBox>
        </div>
      </Page>
    );
  }
  if (isLoading || !role || !initialized) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑角色" />
        <DetailPageSkeleton />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={goBack}
        title={`编辑角色 — ${role.name}`}
        subtitle={
          <Space size={8} wrap>
            <Tag color={role.isSystem ? "blue" : "default"} style={{ margin: 0 }}>
              {role.isSystem ? "系统角色" : "自定义角色"}
            </Tag>
            <Text style={{ color: "var(--qt-text-muted)", fontSize: 13 }}>
              代码 {role.code} 创建后不可改 · 影响所有该角色用户
            </Text>
          </Space>
        }
        actions={
          <Space>
            <Button onClick={goBack}>取消</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={!dirty || adminGuardBroken}
              loading={saving}
              onClick={onSave}
            >
              保存
            </Button>
          </Space>
        }
      />

      {role.code === "ADMIN" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="ADMIN 锁死护栏"
          description={
            <span>
              ADMIN 角色的 <strong>[角色] 资源</strong> 必须保留 <strong>读+改</strong> 权限,
              否则后续无人能调回 (含你自己)。若服务端检测到该配置被违反,保存请求会被拒绝。
            </span>
          }
        />
      ) : null}

      <ProCard title="基础信息" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>名称 <span style={{ color: "var(--qt-text-faint)" }}>*</span></div>
            <Input
              size="large"
              value={name}
              maxLength={40}
              showCount
              onChange={(e) => setName(e.target.value)}
              placeholder="如:业务经理"
            />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 500 }}>说明</div>
            <Input.TextArea
              value={description}
              maxLength={200}
              showCount
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="角色的职责/适用人群"
            />
          </div>
        </div>
      </ProCard>

      <ProCard
        title="权限矩阵"
        extra={
          <Text style={{ color: "var(--qt-text-muted)", fontSize: 12 }}>
            勾选即生效 · 共 {perms.length} 个资源已配置
          </Text>
        }
        style={{ marginBottom: 12 }}
      >
        <PermissionMatrix value={perms} onChange={setPerms} />
        {adminGuardBroken ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message="ADMIN 角色的 [角色] 资源缺少 READ 或 UPDATE 权限"
            description="保存按钮已禁用;勾回 [角色] 资源的读+改后再保存。"
          />
        ) : null}
      </ProCard>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={goBack}>取消</Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          disabled={!dirty || adminGuardBroken}
          loading={saving}
          onClick={onSave}
        >
          保存
        </Button>
      </div>
    </Page>
  );
}

function samePerms(a: Permission[], b: Permission[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (arr: Permission[]) =>
    new Map(arr.map((p) => [p.resource, [...p.actions].sort()]) as Array<[string, string[]]>);
  const ma = norm(a);
  const mb = norm(b);
  for (const [k, v] of ma) {
    const other = mb.get(k);
    if (!other || other.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) if (other[i] !== v[i]) return false;
  }
  return true;
}

function adminPermsSafe(perms: Permission[]): boolean {
  const rolePerm = perms.find((p) => p.resource === "ROLE");
  return !!rolePerm && rolePerm.actions.includes("READ") && rolePerm.actions.includes("UPDATE");
}
