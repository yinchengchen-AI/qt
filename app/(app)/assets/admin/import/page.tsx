"use client";
import { useState } from "react";
import { Button, Card, Select, Space, Table, Tag, Upload, Alert, App, Steps, Empty } from "antd";
import { InboxOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { ASSET_TYPE, type AssetType } from "@/types/enums";
import { ASSET_TYPE_MAP } from "@/lib/enum-maps";

type ParsedRow = {
  rowIndex: number;
  values: Record<string, string>;
  parsed?: unknown;
  errors: string[];
};

type ParseResult = {
  type: string;
  rows: ParsedRow[];
  totalRows: number;
  validCount: number;
  errorCount: number;
};

const TYPE_OPTIONS = ASSET_TYPE.map((t) => ({ value: t, label: ASSET_TYPE_MAP[t] ?? t }));

export default function AssetImportPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [type, setType] = useState<AssetType>("LICENSE");
  const [step, setStep] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);

  const handleTemplateDownload = () => {
    window.open(`/api/assets/import-template?type=${type}`, "_blank");
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("type", type);
      fd.set("file", file);
      const res = await fetch("/api/assets/import", { method: "POST", body: fd, credentials: "include" });
      const j = await res.json();
      if (j.code !== 0) {
        message.error(j.message ?? "解析失败");
        setParsing(false);
        return false;
      }
      setResult(j.data);
      setStep(1);
      message.success(`解析完成: 共 ${j.data.totalRows} 行, ${j.data.validCount} 行有效, ${j.data.errorCount} 行错误`);
    } catch (e) {
      message.error(`解析失败: ${(e as Error).message}`);
    } finally {
      setParsing(false);
    }
    return false; // 阻止 antd Upload 默认上传
  };

  const handleConfirm = async () => {
    if (!result) return;
    if (result.errorCount > 0) {
      message.error("存在错误行,请先修正后再导入");
      return;
    }
    setConfirming(true);
    try {
      const validRows = result.rows.filter((r) => r.parsed).map((r) => r.parsed);
      const res = await fetch("/api/assets/import-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type, rows: validRows })
      });
      const j = await res.json();
      if (j.code !== 0) {
        message.error(j.message ?? "导入失败");
        return;
      }
      message.success(`成功导入 ${j.data.inserted} 条资产`);
      setStep(2);
    } catch (e) {
      message.error(`导入失败: ${(e as Error).message}`);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Page>
      <PageHeader title="批量导入资产" back={() => router.push("/assets")} subtitle="支持 8 种资产类型,每类型对应一个 xlsx 模板" />
      <Card>
        <Steps
          current={step}
          items={[
            { title: "选择类型 + 下载模板" },
            { title: "上传文件 + 预览" },
            { title: "确认导入" }
          ]}
          style={{ marginBottom: 24 }}
        />

        {step === 0 && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Space>
              <span>资产类型:</span>
              <Select
                value={type}
                onChange={setType}
                options={TYPE_OPTIONS}
                style={{ width: 200 }}
              />
              <Button icon={<DownloadOutlined />} onClick={handleTemplateDownload}>
                下载 {ASSET_TYPE_MAP[type]} 模板
              </Button>
            </Space>
            <Alert
              type="info"
              showIcon
              title="模板说明"
              description={
                <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                  <li>每个类型一张工作表(单 sheet);第一行是表头(标 * 为必填)</li>
                  <li>日期字段使用 ISO 格式: <code>YYYY-MM-DDTHH:mm:ssZ</code>(如 2024-01-01T00:00:00Z)</li>
                  <li>多个申请人/标签用 <code>逗号</code> 或 <code>;</code> 分隔</li>
                  <li>修改后保存,再到本页面重新上传</li>
                </ul>
              }
            />
            <Upload.Dragger
              accept=".xlsx,.xls"
              beforeUpload={handleFile}
              showUploadList={false}
              disabled={parsing}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">{parsing ? "解析中..." : "点击或拖拽 xlsx 文件到此处"}</p>
              <p className="ant-upload-hint">支持 .xlsx / .xls 格式,单文件 ≤ 50MB</p>
            </Upload.Dragger>
          </Space>
        )}

        {step === 1 && result && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Space>
              <Tag color="green"><CheckCircleOutlined /> {result.validCount} 行有效</Tag>
              <Tag color="red"><CloseCircleOutlined /> {result.errorCount} 行错误</Tag>
              <Button onClick={() => { setStep(0); setResult(null); }}>重新上传</Button>
              <Button
                type="primary"
                onClick={handleConfirm}
                disabled={result.errorCount > 0 || result.validCount === 0}
                loading={confirming}
              >
                确认导入 {result.validCount} 条
              </Button>
            </Space>
            {result.errorCount > 0 && (
              <Alert type="warning" showIcon message={`有 ${result.errorCount} 行存在错误,请先在 Excel 中修正再重新上传`} />
            )}
            <Table
              dataSource={result.rows}
              rowKey="rowIndex"
              size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: true }}
              columns={[
                { title: "行号", dataIndex: "rowIndex", width: 70 },
                {
                  title: "校验",
                  dataIndex: "errors",
                  width: 80,
                  render: (errors: string[]) =>
                    errors.length > 0
                      ? <Tag color="red">{errors.length} 错</Tag>
                      : <Tag color="green"><CheckCircleOutlined /></Tag>
                },
                { title: "名称", dataIndex: ["values", "name"], width: 200, ellipsis: true },
                {
                  title: "错误详情",
                  dataIndex: "errors",
                  render: (errors: string[]) => errors.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 16, color: "#cf1322" }}>
                      {errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
                      {errors.length > 3 && <li>... +{errors.length - 3} 条</li>}
                    </ul>
                  ) : <span style={{ color: "#999" }}>—</span>
                }
              ]}
            />
          </Space>
        )}

        {step === 2 && (
          <Empty
            image={<CheckCircleOutlined style={{ fontSize: 64, color: "#52c41a" }} />}
            imageStyle={{ height: 80 }}
            description="导入完成"
          >
            <Space>
              <Button onClick={() => router.push("/assets/list")}>查看资产列表</Button>
              <Button type="primary" onClick={() => { setStep(0); setResult(null); }}>继续导入</Button>
            </Space>
          </Empty>
        )}
      </Card>
    </Page>
  );
}
