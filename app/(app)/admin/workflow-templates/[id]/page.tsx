"use client";
// P4: 单模板详情 + 任务编辑
import useSWR from "swr";
import type { FormInstance } from "antd";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Upload,
  Space,
  Switch,
  Tag,
  Typography
} from "antd";
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, SwapOutlined, UploadOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import {
  WORKFLOW_PHASE_MAP,
  WORKFLOW_RECURRENCE_UNIT_MAP,
  SERVICE_TYPE_MAP,
  WORKFLOW_REQUIRED_ROLE_MAP
} from "@/lib/enum-maps";
import { WORKFLOW_PHASE_ORDER, WORKFLOW_RECURRENCE_UNIT } from "@/types/enums";

const { Text } = Typography;

type Task = {
  id: string;
  code: string;
  name: string;
  sort: number;
  description: string | null;
  requiredRole: string | null;
  requiresDeliverable: boolean;
  requiresOnsite: boolean;
  requiresTwoStepReview: boolean;
  isRecurring: boolean;
  recurrenceUnit: string | null;
  recurrenceInterval: number | null;
  estimateDays: number | null;
};

type Stage = {
  id: string;
  phase: string;
  code: string;
  name: string;
  sort: number;
  description: string | null;
  isRequired: boolean;
  taskCount: number;
  tasks: Task[];
};

type Template = {
  id: string;
  serviceType: string;
  name: string;
  version: number;
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  stages: Stage[];
};

export default function TemplateDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const { data, isLoading, mutate } = useSWR<Template>("/api/admin/workflow-templates/" + id);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [addingToStage, setAddingToStage] = useState<string | null>(null);
  const [migratingFrom, setMigratingFrom] = useState<Task | null>(null);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [stageForm] = Form.useForm();
  const [importing, setImporting] = useState(false);
  const [metaForm] = Form.useForm();
  const [taskForm] = Form.useForm();

  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={() => router.push("/admin/workflow-templates")} title="加载中..." />
        <Skeleton active />
      </Page>
    );
  }

  const onSaveMeta = async (vals: { name: string; description: string | null; isActive: boolean }) => {
    const r = await fetch("/api/admin/workflow-templates/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(vals)
    });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success("已保存");
    setEditingMeta(false);
    await mutate();
  };

  const openAddTask = (stageId: string) => {
    taskForm.resetFields();
    setAddingToStage(stageId);
  };

  const onAddTask = async (vals: Record<string, unknown>) => {
    if (!addingToStage) return;
    const r = await fetch("/api/admin/workflow-templates/" + id + "/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...vals, stageId: addingToStage })
    });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success("已添加");
    setAddingToStage(null);
    await mutate();
  };

  const openEditTask = (t: Task) => {
    taskForm.setFieldsValue({
      code: t.code,
      name: t.name,
      sort: t.sort,
      description: t.description ?? "",
      requiredRole: t.requiredRole ?? undefined,
      requiresDeliverable: t.requiresDeliverable,
      requiresOnsite: t.requiresOnsite,
      requiresTwoStepReview: t.requiresTwoStepReview,
      isRecurring: t.isRecurring,
      recurrenceUnit: t.recurrenceUnit,
      recurrenceInterval: t.recurrenceInterval,
      estimateDays: t.estimateDays
    });
    setEditingTask(t);
  };

  const onUpdateTask = async (vals: Record<string, unknown>) => {
    if (!editingTask) return;
    const r = await fetch("/api/admin/workflow-templates/" + id + "/tasks/" + editingTask.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(vals)
    });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success("已保存");
    setEditingTask(null);
    await mutate();
  };

  const onDeleteTask = (t: Task) => {
    modal.confirm({
      title: "删除任务「" + t.name + "」?",
      content: "无实例引用时才能删除。若有正在使用的项目,会拒绝。如需迁移实例,请用「迁移到其他任务」。",
      okType: "danger",
      onOk: async () => {
        const r = await fetch("/api/admin/workflow-templates/" + id + "/tasks/" + t.id, { method: "DELETE", credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) return message.error(j.message);
        message.success("已删除");
        await mutate();
      }
    });
  };
  const openEditStage = (s: Stage) => {
    stageForm.setFieldsValue({ code: s.code, name: s.name, sort: s.sort, description: s.description ?? "", isRequired: s.isRequired });
    setEditingStage(s);
  };
  const onSubmitStage = async (vals: Record<string, unknown>) => {
    if (editingStage) {
      const r = await fetch("/api/admin/workflow-templates/" + id + "/stages/" + editingStage.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(vals)
      });
      const j = await r.json();
      if (j.code !== 0) return message.error(j.message);
      message.success("已保存");
      setEditingStage(null);
    } else {
      const r = await fetch("/api/admin/workflow-templates/" + id + "/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(vals)
      });
      const j = await r.json();
      if (j.code !== 0) return message.error(j.message);
      message.success("已添加");
      setAddingStage(false);
    }
    await mutate();
  };
  const onDeleteStage = (s: Stage) => {
    modal.confirm({
      title: "删除阶段「" + s.name + "」?",
      content: "该阶段必须没有任何任务,否则拒绝删除。",
      okType: "danger",
      onOk: async () => {
        const r = await fetch("/api/admin/workflow-templates/" + id + "/stages/" + s.id, { method: "DELETE", credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) return message.error(j.message);
        message.success("已删除");
        await mutate();
      }
    });
  };

  // 导出:GET JSON 文件
  const onExport = async () => {
    const r = await fetch("/api/admin/workflow-templates/" + id + "/export", { credentials: "include" });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    const blob = new Blob([JSON.stringify(j.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template-${data.serviceType}-v${data.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导入:从 JSON 文件新建一份
  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const r = await fetch("/api/admin/workflow-templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ data: json })
      });
      const j = await r.json();
      if (j.code !== 0) { message.error(j.message); return false; }
      message.success(`已导入:${j.data.stageCount} 阶段 / ${j.data.taskCount} 任务 (新版本 v${j.data.version})`);
      router.push("/admin/workflow-templates");
      return false;
    } catch (e) {
      const err = e as { message?: string };

      message.error("导入失败:" + (err.message ?? String(e)));
      return false;
    } finally {
      setImporting(false);
    }
  };

  // 任务迁移(让被引用任务可被删除)
  // 实际迁移操作改用 MigrationModal 组件(下方声明)——这里只触发打开

  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/workflow-templates")}
        title={(SERVICE_TYPE_MAP[data.serviceType] ?? data.serviceType) + " · " + data.name}
        subtitle={"版本 v" + data.version + " · " + (data.isActive ? "已激活" : "未激活")}
        meta={data.isActive ? <Tag color="success">激活</Tag> : <Tag>未激活</Tag>}
        actions={
          <Button icon={<EditOutlined />} onClick={() => {
            metaForm.setFieldsValue({ name: data.name, description: data.description ?? "", isActive: data.isActive });
            setEditingMeta(true);
          }}>
            编辑元数据
          </Button>
        }
      />

      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <Button icon={<DownloadOutlined />} onClick={onExport}>导出 JSON</Button>
        <Upload accept=".json" showUploadList={false} beforeUpload={onImport}>
          <Button icon={<UploadOutlined />} loading={importing}>从 JSON 导入(新版本)</Button>
        </Upload>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="模板修改仅影响新实例化的项目"
        description="已存在的项目用的是实例化时的快照,不会被本次修改影响。如需旧项目也用新模板,请到项目详情页重新 init(force=true)。"
      />

      {data.stages.length === 0 ? (
        <Empty description="此模板暂未配置阶段" />
      ) : (
        <Collapse
          defaultActiveKey={data.stages.map((s) => s.id)}
          items={data.stages.map((s) => ({
            key: s.id,
            label: (
              <Space>
                <Text strong>{WORKFLOW_PHASE_MAP[s.phase] ?? s.name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>({s.name})</Text>
                <Tag>{s.tasks.length} 任务</Tag>
                {s.isRequired ? <Tag color="red">required</Tag> : <Tag color="default">可选</Tag>}
                <Button size="small" type="text" icon={<EditOutlined />} onClick={(ev) => { ev.stopPropagation(); openEditStage(s); }}>编辑</Button>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(ev) => { ev.stopPropagation(); onDeleteStage(s); }}>删除</Button>
              </Space>
            ),
            children: (
              <div>
                {s.description && <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>{s.description}</Text>}
                {s.tasks.map((t) => (
                  <Card
                    key={t.id}
                    size="small"
                    style={{ marginBottom: 8 }}
                    title={
                      <Space>
                        <Text strong>{t.name}</Text>
                        <Tag>{t.code}</Tag>
                        {t.requiresDeliverable && <Tag color="cyan">交付物</Tag>}
                        {t.requiresOnsite && <Tag color="gold">现场</Tag>}
                        {t.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
                        {t.isRecurring && <Tag color="geekblue">循环</Tag>}
                        {t.estimateDays && <Tag>预估 {t.estimateDays} 天</Tag>}
                      </Space>
                    }
                    extra={
                      <Space>
                        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditTask(t)}>编辑</Button>
                        <Button size="small" type="text" icon={<SwapOutlined />} onClick={() => setMigratingFrom(t)}>迁移</Button>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onDeleteTask(t)}>删除</Button>
                      </Space>
                    }
                  >
                    {t.description && <Text type="secondary" style={{ fontSize: 12 }}>{t.description}</Text>}
                    {t.requiredRole && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>期望角色: </Text>
                        <Tag>{WORKFLOW_REQUIRED_ROLE_MAP[t.requiredRole] ?? t.requiredRole}</Tag>
                      </div>
                    )}
                    {t.isRecurring && (
                      <div style={{ marginTop: 4 }}>
                        <Tag color="geekblue">每 {t.recurrenceInterval ?? 1} {WORKFLOW_RECURRENCE_UNIT_MAP[t.recurrenceUnit ?? ""] ?? t.recurrenceUnit}</Tag>
                      </div>
                    )}
                  </Card>
                ))}
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => openAddTask(s.id)}
                >
                  在 {WORKFLOW_PHASE_MAP[s.phase] ?? s.name} 添加任务
                </Button>
              </div>
            )
          }))}
        />
      )}

      <Modal
        open={editingMeta}
        title="编辑模板元数据"
        onCancel={() => setEditingMeta(false)}
        onOk={() => metaForm.submit()}
        okText="保存"
      >
        <Form form={metaForm} layout="vertical" onFinish={onSaveMeta}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="isActive" label="是否激活" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={addingToStage !== null}
        title="添加任务"
        onCancel={() => setAddingToStage(null)}
        onOk={() => taskForm.submit()}
        okText="添加"
        width={640}
      >
        <TaskFormFields form={taskForm} onFinish={onAddTask} />
      </Modal>

      <Modal
        open={editingTask !== null}
        title={"编辑任务: " + (editingTask?.name ?? "")}
        onCancel={() => setEditingTask(null)}
        onOk={() => taskForm.submit()}
        okText="保存"
        width={640}
      >
        <TaskFormFields form={taskForm} onFinish={onUpdateTask} />
      </Modal>
      <Modal
        open={addingStage || editingStage !== null}
        title={editingStage ? "编辑阶段" : "添加阶段"}
        onCancel={() => { setAddingStage(false); setEditingStage(null); }}
        onOk={() => stageForm.submit()}
        okText="保存"
      >
        <Form form={stageForm} layout="vertical" onFinish={onSubmitStage}
          initialValues={{ sort: 999, isRequired: true }}>
          {!editingStage && (
            <Form.Item name="phase" label="阶段" rules={[{ required: true }]}>
              <Select options={WORKFLOW_PHASE_ORDER.map((p) => ({ value: p, label: WORKFLOW_PHASE_MAP[p] + " (" + p + ")" }))} />
            </Form.Item>
          )}
          <Form.Item name="code" label="阶段编码" rules={[{ required: true, max: 50, pattern: /^[A-Z0-9_]+$/ }]}>
            <Input placeholder="例如:EXECUTE_EXTRA" />
          </Form.Item>
          <Form.Item name="name" label="阶段名称" rules={[{ required: true, max: 100 }]}>
            <Input placeholder="例如:补充实施" />
          </Form.Item>
          <Form.Item name="sort" label="排序(同 phase 内)">
            <InputNumber min={0} max={99} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="isRequired" label="是否必填" valuePropName="checked">
            <Select options={[{ value: true, label: "必填(required)" }, { value: false, label: "可选" }]} />
          </Form.Item>
        </Form>
      </Modal>
      {migratingFrom && (
        <MigrationModal
          fromTask={migratingFrom}
          candidates={data!.stages.flatMap((s) => s.tasks).filter((x) => x.id !== migratingFrom.id).map((c) => {
            const stage = data!.stages.find((s) => s.tasks.some((x) => x.id === c.id));
            return { id: c.id, label: "[" + (WORKFLOW_PHASE_MAP[stage?.phase ?? ""] ?? stage?.phase) + "] " + c.name + " (" + c.code + ")" };
          })}
          onClose={() => setMigratingFrom(null)}
          onMigrated={() => mutate()}
        />
      )}
    </Page>
  );
}

function MigrationModal({ fromTask, candidates, onClose, onMigrated }: { fromTask: Task; candidates: { id: string; label: string }[]; onClose: () => void; onMigrated: () => void }) {
  const [target, setTarget] = useState<string | undefined>(candidates[0]?.id);
  const { message } = AntdApp.useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={"迁移「" + fromTask.name + "」的实例"} onCancel={onClose} onOk={async () => {
      if (!target) { message.warning("请选择目标任务"); return; }
      setBusy(true);
      try {
        const r = await fetch("/api/admin/workflow-templates/tasks/migrate", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ fromTaskId: fromTask.id, toTaskId: target }) });
        const j = await r.json();
        if (j.code !== 0) { message.error(j.message); return; }
        message.success("已迁移 " + j.data.migratedInstances + " 个实例(跨 " + j.data.migratedProjects + " 个项目)");
        onMigrated();
        onClose();
      } finally { setBusy(false); }
    }} okText="执行迁移" confirmLoading={busy}>
      <p>把引用「" + fromTask.name + "」的所有实例改挂到目标任务,即可删除旧任务。</p>
      <Select value={target} onChange={setTarget} style={{ width: "100%" }} options={candidates} />
    </Modal>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TaskFormFields({ form, onFinish }: { form: FormInstance<any>; onFinish: (vals: Record<string, unknown>) => void }) {
  return (
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ sort: 99, requiresDeliverable: false, requiresOnsite: false, requiresTwoStepReview: false, isRecurring: false }}>
      <Form.Item name="code" label="任务编码 (英文,模板内唯一)" rules={[{ required: true, max: 50, pattern: /^[A-Z0-9_]+$/ }]}>
        <Input placeholder="例如:VISIT_INIT" />
      </Form.Item>
      <Form.Item name="name" label="任务名称" rules={[{ required: true, max: 100 }]}>
        <Input placeholder="例如:委托单位初访" />
      </Form.Item>
      <Form.Item name="sort" label="排序" rules={[{ required: true }]}>
        <InputNumber min={0} max={999} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item name="description" label="描述">
        <Input.TextArea rows={2} maxLength={2000} showCount />
      </Form.Item>
      <Form.Item name="requiredRole" label="期望执行角色">
        <Select allowClear options={Object.entries(WORKFLOW_REQUIRED_ROLE_MAP).map(([v, l]) => ({ value: v, label: l }))} />
      </Form.Item>
      <Form.Item name="estimateDays" label="预估天数">
        <InputNumber min={1} max={365} style={{ width: "100%" }} />
      </Form.Item>
      <Space size={16} wrap>
        <Form.Item name="requiresDeliverable" valuePropName="checked">
          <Checkbox>需交付物</Checkbox>
        </Form.Item>
        <Form.Item name="requiresOnsite" valuePropName="checked">
          <Checkbox>现场</Checkbox>
        </Form.Item>
        <Form.Item name="requiresTwoStepReview" valuePropName="checked">
          <Checkbox>二审</Checkbox>
        </Form.Item>
        <Form.Item name="isRecurring" valuePropName="checked">
          <Checkbox>循环任务</Checkbox>
        </Form.Item>
      </Space>
      <Form.Item shouldUpdate noStyle>
        {() => {
          const isRec = form.getFieldValue("isRecurring");
          if (!isRec) return null;
          return (
            <Space>
              <Form.Item name="recurrenceUnit" label="周期单位" rules={[{ required: true }]}>
                <Select
                  style={{ width: 120 }}
                  options={WORKFLOW_RECURRENCE_UNIT.map((u) => ({ value: u, label: WORKFLOW_RECURRENCE_UNIT_MAP[u] }))}
                />
              </Form.Item>
              <Form.Item name="recurrenceInterval" label="间隔" rules={[{ required: true }]}>
                <InputNumber min={1} max={365} />
              </Form.Item>
            </Space>
          );
        }}
      </Form.Item>
    </Form>
  );
}
