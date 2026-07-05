"use client";
import { ProCard } from "@ant-design/pro-components";
import { Column } from "@ant-design/charts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Col, DatePicker, Row, Space, App as AntdApp, Typography, Tag, Drawer, Spin, Descriptions } from "antd";
import { DownloadOutlined, FilePdfOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatGrid, type StatItem } from "@/components/stat-grid";
import { EmptyState } from "@/components/empty-state";
import { formatCompact, formatCurrency } from "@/lib/format";
import { downloadExcel } from "@/lib/excel-client";
import { useResponsive } from "@/lib/use-breakpoint";
import { toDateRangeQuery } from "@/lib/date-range";
import { openPrintWindow } from "@/lib/print-client";

const { Text } = Typography;

// 业绩明细中开票率/回款率的 Tag 颜色阈值（百分比）
const INVOICE_RATE_THRESHOLDS = { green: 70, blue: 40 } as const;
const PAYMENT_RATE_THRESHOLDS = { green: 80, blue: 50 } as const;

type Row = {
  userId: string; name: string; employeeNo: string;
  contractAmount: number; invoiceAmount: number; paymentAmount: number; contractCount: number;
};

function rankEmoji(i: number) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return "";
}

// 员工分类色板：同一员工在四个图表中保持同一颜色，不同员工颜色不同
// 已用 dataviz skill 的 validate_palette.js 在 light 表面验证通过（CVD ≥ 12，labels 提供 relief）
const EMPLOYEE_CATEGORICAL_COLORS = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
  "#13c2c2", // cyan
  "#1890ff", // antd blue
] as const;

export default function PerformancePage() {
  const { isMobile } = useResponsive();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 员工业绩默认本年度 1 月 1 日 00:00 ~ 当前; 用户可改/清空
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(() => [
    dayjs().startOf("year"),
    dayjs()
  ]);
  const { message } = AntdApp.useApp();

  const chartHeight = isMobile ? 240 : 380;
  // 移动端只显示 Top 5,完整数据可导出
  const TOP_N = isMobile ? 5 : 10;
  const visibleRows = isMobile && rows.length > TOP_N ? rows.slice(0, TOP_N) : rows;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      const { from, to } = toDateRangeQuery(range);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      // 改用签约人维度 (与 PDF 合计、抽屉明细同口径), xlsx 导出仍走原 owner 维度端点不受影响
      const r = await fetch(`/api/statistics/employee-performance/by-signer?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setRows(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // 业绩明细抽屉：点击行时按 userId 拉明细
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerData, setDrawerData] = useState<{
    signer: { id: string; name: string; employeeNo: string } | null;
    rows: Array<{
      contractId: string; contractNo: string; region: string;
      customerName: string; serviceTypeLabel: string; signDate: string;
      totalAmount: number;
    }>;
    totals: { contractCount: number; contractAmount: number; subtotalWan: number };
  } | null>(null);

  const openDrawer = useCallback(async (userId: string) => {
    setDrawerUserId(userId);
    setDrawerLoading(true);
    try {
      const qs = new URLSearchParams({ userId });
      const { from, to } = toDateRangeQuery(range);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/statistics/employee-performance/detail?${qs}`, { credentials: "include" });
      const j = await r.json();
      if (j.code !== 0) throw new Error(j.message);
      setDrawerData(j.data);
    } catch (e) {
      message.error((e as Error).message);
      setDrawerData(null);
    } finally {
      setDrawerLoading(false);
    }
  }, [range, message]);

  const closeDrawer = () => {
    setDrawerUserId(null);
    setDrawerData(null);
  };

  const downloadPdf = () => {
    const qs = new URLSearchParams();
    const { from, to } = toDateRangeQuery(range);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      openPrintWindow(`/api/statistics/employee-performance/pdf?${qs}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const download = async () => {
    const qs = new URLSearchParams({ type: "employee-performance" });
    const { from, to } = toDateRangeQuery(range);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    // 走 downloadExcel:从服务端 Content-Disposition 拿真实文件名,中文不会被截断
    try {
      await downloadExcel(`/api/statistics/export?${qs}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const totals = useMemo(() => ({
    contract: rows.reduce((s, r) => s + r.contractAmount, 0),
    invoice: rows.reduce((s, r) => s + r.invoiceAmount, 0),
    payment: rows.reduce((s, r) => s + r.paymentAmount, 0),
    count: rows.reduce((s, r) => s + r.contractCount, 0),
  }), [rows]);

  const kpis: StatItem[] = [
    { label: "合同总额", value: formatCompact(totals.contract), suffix: "", description: `共 ${totals.count} 份` },
    { label: "已开票总额", value: formatCompact(totals.invoice), suffix: "", description: `开票率 ${totals.contract > 0 ? ((totals.invoice / totals.contract) * 100).toFixed(1) : 0}%` },
    { label: "已回款总额", value: formatCompact(totals.payment), suffix: "", description: `回款率 ${totals.invoice > 0 ? ((totals.payment / totals.invoice) * 100).toFixed(1) : 0}%` },
    { label: "员工人数", value: rows.length, suffix: "人", description: `人均 ${formatCompact(totals.contract / Math.max(rows.length, 1))} 元` },
  ];

  // 按员工名字母顺序分配稳定颜色，保证同一员工在四个桶柱图中颜色一致
  const employeeColorMap = useMemo(() => {
    const uniqueNames = Array.from(new Set(rows.map((r) => r.name))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const map = new Map<string, string>();
    uniqueNames.forEach((name, i) => {
      map.set(name, EMPLOYEE_CATEGORICAL_COLORS[i % EMPLOYEE_CATEGORICAL_COLORS.length] ?? EMPLOYEE_CATEGORICAL_COLORS[0]);
    });
    return map;
  }, [rows]);

  // 图表用 Top N 数据，每个员工绑定固定颜色
  const contractChartData = visibleRows.map(r => ({ name: r.name, value: r.contractAmount, color: employeeColorMap.get(r.name) ?? EMPLOYEE_CATEGORICAL_COLORS[0] }));
  const invoiceChartData = visibleRows.map(r => ({ name: r.name, value: r.invoiceAmount, color: employeeColorMap.get(r.name) ?? EMPLOYEE_CATEGORICAL_COLORS[0] }));
  const paymentChartData = visibleRows.map(r => ({ name: r.name, value: r.paymentAmount, color: employeeColorMap.get(r.name) ?? EMPLOYEE_CATEGORICAL_COLORS[0] }));
  const contractCountChartData = visibleRows.map(r => ({ name: r.name, value: r.contractCount, color: employeeColorMap.get(r.name) ?? EMPLOYEE_CATEGORICAL_COLORS[0] }));

  return (
    <Page>
      <PageHeader
        title="员工业绩"
        subtitle="按员工汇总合同、开票、回款(业务人员仅看自己负责的合同);支持时间范围筛选"
        actions={
          <Space wrap>
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => setRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
              allowClear
            />
            <Button icon={<FilePdfOutlined />} onClick={downloadPdf}>导出 PDF</Button>
            <Button icon={<DownloadOutlined />} onClick={download}>导出 xlsx</Button>
          </Space>
        }
      />

      {error ? (
        <EmptyState error={{ message: error, onRetry: load }} title="加载失败" />
      ) : (
        <>
          <StatGrid items={kpis} columns={4} loading={loading && rows.length === 0} />

          <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
            <Col xs={24} lg={12}>
              <ProCard title="合同额排行">
                {contractChartData.length > 0 ? (
                  <Column data={contractChartData} xField="name" yField="value" colorField="color" height={chartHeight} autoFit legend={false}
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
            <Col xs={24} lg={12}>
              <ProCard title="已开票排行">
                {invoiceChartData.length > 0 ? (
                  <Column data={invoiceChartData} xField="name" yField="value" colorField="color" height={chartHeight} autoFit legend={false}
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <ProCard title="已回款排行">
                {paymentChartData.length > 0 ? (
                  <Column data={paymentChartData} xField="name" yField="value" colorField="color" height={chartHeight} autoFit legend={false}
                    label={{ text: (d: Record<string, unknown>) => formatCompact(d.value as number), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
            <Col xs={24} lg={12}>
              <ProCard title="合同数量排行">
                {rows.length > 0 ? (
                  <Column data={contractCountChartData} xField="name" yField="value" colorField="color" height={chartHeight} autoFit legend={false}
                    label={{ text: (d: Record<string, unknown>) => String(d.value), style: { fontSize: 10 } }}
                  />
                ) : <EmptyState empty title="暂无员工业绩" description="当前时间范围内尚无合同、开票或回款记录" height={chartHeight} />}
              </ProCard>
            </Col>
          </Row>

          <div style={{ marginTop: 32 }}>
            <PageHeader
              level="section"
              title={`业绩明细${isMobile && rows.length > TOP_N ? `（Top ${TOP_N}）` : ""}`}
            />
            <ProCard>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 620 : undefined }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #f0f0f0", textAlign: "left" }}>
                      <th style={{ padding: "10px 8px", width: 50 }}>#</th>
                      <th style={{ padding: "10px 8px" }}>员工</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>合同数</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>合同额</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>已开票</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>已回款</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>开票率</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>回款率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      const invRate = r.contractAmount > 0 ? (r.invoiceAmount / r.contractAmount * 100) : 0;
                      const payRate = r.invoiceAmount > 0 ? (r.paymentAmount / r.invoiceAmount * 100) : 0;
                      return (
                        <tr key={r.userId} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => openDrawer(r.userId)}>
                          <td style={{ padding: "10px 8px" }}>
                            {rankEmoji(i) || <Text type="secondary">{i + 1}</Text>}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            <a onClick={(e) => { e.stopPropagation(); openDrawer(r.userId); }} style={{ color: "var(--ant-color-link, #1677ff)" }}>
                              <Text strong>{r.name}</Text>
                            </a>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>{r.employeeNo}</Text>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{r.contractCount}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.contractAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.invoiceAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>{formatCurrency(r.paymentAmount)}</td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={invRate >= INVOICE_RATE_THRESHOLDS.green ? "green" : invRate >= INVOICE_RATE_THRESHOLDS.blue ? "blue" : "orange"}>{invRate.toFixed(1)}%</Tag>
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right" }}>
                            <Tag color={payRate >= PAYMENT_RATE_THRESHOLDS.green ? "green" : payRate >= PAYMENT_RATE_THRESHOLDS.blue ? "blue" : "orange"}>{payRate.toFixed(1)}%</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {isMobile && rows.length > TOP_N ? (
                <div style={{ marginTop: 12, textAlign: "center", color: "var(--qt-processing)", fontSize: 13 }}>
                  共 {rows.length} 条，完整数据请使用「导出 xlsx」
                </div>
              ) : null}
            </ProCard>
          </div>
        </>
      )}

      <Drawer
        title={drawerData?.signer
          ? `${drawerData.signer.name}（${drawerData.signer.employeeNo}）· 业绩明细`
          : "业绩明细"}
        open={drawerUserId !== null}
        onClose={closeDrawer}
        width={isMobile ? "100%" : 720}
        destroyOnClose
      >
        {drawerLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
        ) : drawerData?.signer ? (
          <>
            <Descriptions size="small" column={isMobile ? 1 : 3} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="合同份数">{drawerData.totals.contractCount}</Descriptions.Item>
              <Descriptions.Item label="合同总额">{formatCurrency(drawerData.totals.contractAmount)}</Descriptions.Item>
              <Descriptions.Item label="合计（万元）">{drawerData.totals.subtotalWan.toFixed(2)}</Descriptions.Item>
            </Descriptions>
            {drawerData.rows.length === 0 ? (
              <EmptyState empty title="暂无合同明细" description="当前时间范围内该员工作为签约人没有合同" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #f0f0f0", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>所属区域</th>
                      <th style={{ padding: "8px" }}>企业名称</th>
                      <th style={{ padding: "8px" }}>服务项目</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>合同金额</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>签约日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawerData.rows.map((r) => (
                      <tr key={r.contractId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px" }}>{r.region}</td>
                        <td style={{ padding: "8px" }}>{r.customerName}</td>
                        <td style={{ padding: "8px" }}>{r.serviceTypeLabel}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>{formatCurrency(r.totalAmount)}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>{dayjs(r.signDate).format("YYYY-MM-DD")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState empty title="暂无数据" />
        )}
      </Drawer>
    </Page>
  );
}
