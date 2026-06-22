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
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography
} from "antd";
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import {
  WORKFLOW_PHASE_MAP,
  SERVICE_TYPE_MAP
} from "@/lib/enum-maps";
import { ROLE_CODES, WORKFLOW_PHASE_ORDER } from "@/types/enums";
import { useRoleNameMap } from "@/lib/role-lookup";

const { Text } = Typography;

type Task = {
  id: string;
  stageId: string;
  code: string;
  name: string;
  sort: number;
  description: string | null;
  requiredRole: string | null;
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
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [duplicatingTask, setDuplicatingTask] = useState<Task | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [stageForm] = Form.useForm();
  const [duplicateForm] = Form.useForm();
  const roleNameMap = useRoleNameMap();
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

  const onDuplicateTask = async (vals: { targetStageId: string; newCode: string; newName: string }) => {
    if (!duplicatingTask) return;
    const r = await fetch("/api/admin/workflow-templates/" + id + "/tasks/" + duplicatingTask.id + "/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(vals)
    });
    const j = await r.json();
    if (j.code !== 0) return message.error(j.message);
    message.success("已复制: " + j.data.code);
    setDuplicatingTask(null);
    await mutate();
  };

  const onDeleteTask = (t: Task) => {
    modal.confirm({
      title: "删除任务「" + t.name + "」?",
      content: "无实例引用时才能删除。若有正在使用的项目,会拒绝。",
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


  return (
    <Page>
      <PageHeader
        back={() => router.push("/admin/workflow-templates")}
        title={(SERVICE_TYPE_MAP[data.serviceType] ?? data.serviceType) + " · " + data.name}
        subtitle={"版本 v" + data.version + " · " + (data.isActive ? "已激活" : "未激活")}
        meta={data.isActive ? <Tag color="success">激活</Tag> : <Tag>未激活</Tag>}
        actions={
          <Space>
<Button icon={<EditOutlined />} onClick={() => {
              metaForm.setFieldsValue({ name: data.name, description: data.description ?? "", isActive: data.isActive });
              setEditingMeta(true);
            }}>
              编辑元数据
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="模板修改仅影响新实例化的项目"
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
                      </Space>
                    }
                    extra={
                      <Space>
                        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditTask(t)}>编辑</Button>
                        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => {
                          setDuplicatingTask(t);
                          // Default newCode suggestion
                          duplicateForm.setFieldsValue({ targetStageId: t.stageId, newCode: t.code + "_COPY", newName: t.name + " (副本)" });
                        }}>复制</Button>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onDeleteTask(t)}>删除</Button>
                      </Space>
                    }
                  >
                    {t.description && <Text type="secondary" style={{ fontSize: 12 }}>{t.description}</Text>}
                    {t.requiredRole && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>期望角色: </Text>
                        <Tag>{roleNameMap[t.requiredRole] ?? t.requiredRole}</Tag>
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
        forceRender
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
        forceRender
        title="添加任务"
        onCancel={() => setAddingToStage(null)}
        onOk={() => taskForm.submit()}
        okText="添加"
        width={640}
      >
        <TaskFormFields form={taskForm} onFinish={onAddTask} roleNameMap={roleNameMap} />
      </Modal>

      <Modal
        open={editingTask !== null}
        forceRender
        title={"编辑任务: " + (editingTask?.name ?? "")}
        onCancel={() => setEditingTask(null)}
        onOk={() => taskForm.submit()}
        okText="保存"
        width={640}
      >
        <TaskFormFields form={taskForm} onFinish={onUpdateTask} roleNameMap={roleNameMap} />
      </Modal>
      <Modal
        open={addingStage || editingStage !== null}
        forceRender
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
            <Select options={[{ value: true, label: "必填" }, { value: false, label: "可选" }]} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!duplicatingTask}
        forceRender
        title={duplicatingTask ? "复制任务: " + duplicatingTask.name : "复制任务"}
        onCancel={() => setDuplicatingTask(null)}
        onOk={() => duplicateForm.submit()}
        okText="复制"
        width={520}
      >
          <Form form={duplicateForm} layout="vertical" onFinish={onDuplicateTask}>
            <Form.Item name="targetStageId" label="目标阶段" rules={[{ required: true }]}>
              <Select
                options={data!.stages.map((s: Stage) => ({
                  value: s.id,
                  label: "[" + (WORKFLOW_PHASE_MAP[s.phase] ?? s.phase) + "] " + s.name
                }))}
              />
            </Form.Item>
            <Form.Item name="newCode" label="新任务编码" rules={[{ required: true, max: 50, pattern: /^[A-Z0-9_]+$/ }]}>
              <Input placeholder="例如:VISIT_INIT_COPY" />
            </Form.Item>
            <Form.Item name="newName" label="新任务名称" rules={[{ required: true, max: 100 }]}>
              <Input placeholder="例如:委托单位初访 (副本)" />
            </Form.Item>
          </Form>
        </Modal>
    </Page>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TaskFormFields({ form, onFinish, roleNameMap }: { form: FormInstance<any>; onFinish: (vals: Record<string, unknown>) => void; roleNameMap: Record<string, string> }) {
  return (
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ sort: 99 }}>
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
        <Select allowClear options={ROLE_CODES.map((c) => ({ value: c, label: roleNameMap[c] ?? c }))} />
      </Form.Item>
    </Form>
  );
}
