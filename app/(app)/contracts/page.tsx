"use client";
import { ProTable } from "@ant-design/pro-components";
import { Button, App as AntdApp, Tag } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { useStatusValueEnum } from "@/lib/use-status-enum";
import { makeListRequest } from "@/lib/use-list-request";
import { useRegionOptions } from "@/lib/use-region-options";
import { formatRegion, splitRegionPath } from "@/lib/region";
import { useDict } from "@/lib/dict-client";
import { downloadExcel } from "@/lib/excel-client";
import { CurrencyCell, DateCell } from "@/components/table-cells";
import { useResponsive } from "@/lib/use-breakpoint";
import { BILLING_STATUS_MAP } from "@/lib/enum-maps";

type Row = {
  id: string;
  contractNo: string;
  customerName: string;
  customerProvince: string;
  customerCity: string;
  customerDistrict: string;
  customerTown: string;
  title: string;
  serviceType: string;
  signDate: string;
  totalAmount: string;
  invoicedAmount: number;
  paidAmount: number;
  billingStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  ownerUserId: string;
  ownerName: string;
  ownerEmployeeNo: string;
  status: string;
};

export default function ContractsPage() {
  const router = useRouter();
  const { isMobile } = useResponsive();
  const statusEnum = useStatusValueEnum("contract");
  const serviceTypeDict = useDict("SERVICE_TYPE");
  const serviceTypeEnum = Object.fromEntries(
    serviceTypeDict.map((d) => [d.code, { text: d.label }])
  );
  const searchRef = useRef<Record<string, unknown>>({});
  const { message } = AntdApp.useApp();
  // 地区级联 options 走共享 hook (含"未知"节点, 见 lib/region.ts); 失败时显式提示, 不再静默空面板
  const { regionOptions, regionError } = useRegionOptions();
  useEffect(() => {
    if (regionError) message.warning("地区数据加载失败，客户区域筛选暂不可用");
  }, [regionError, message]);

  const handleExport = async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchRef.current)) {
      if (v == null || v === "") continue;
      qs.set(k, String(v));
    }
    try {
      await downloadExcel(`/api/contracts/export${qs.toString() ? `?${qs}` : ""}`, "合同列表.xlsx");
      message.success("已开始下载，请稍候");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Page>
      <PageHeader
        title="合同管理"
        subtitle="覆盖合同全生命周期：草稿、生效、已完结；支持按客户、状态筛选"
        actions={
          <>
            <Button key="export" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 Excel
            </Button>
            <Button key="add" type="primary" onClick={() => router.push("/contracts/new")}>
              新建合同
            </Button>
          </>
        }
      />
      <ProTable<Row>
        rowKey="id"
        search={{ labelWidth: "auto", defaultCollapsed: isMobile, layout: isMobile ? "vertical" : undefined }}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: !isMobile, size: isMobile ? "small" : undefined }}
        cardBordered={false}
        sticky={isMobile}
        request={async (params) => {
          // 客户区域级联: cascader 给的是路径数组 ["浙江省", "杭州市", ...] (任意前缀),
          // 拆成 4 个标量传给后端 (走 customer 关系过滤); dataIndex="region" 是虚拟字段
          const regionParams = splitRegionPath(params.region);
          searchRef.current = {
            keyword: params.keyword,
            status: params.status,
            customerId: params.customerId,
            includeLegacyZeroAmount: params.includeLegacyZeroAmount,
            ...regionParams
          };
          const apiParams: Record<string, unknown> = { ...params, ...regionParams };
          delete apiParams.region;
          return makeListRequest<Row>("/api/contracts")(apiParams);
        }}
        columns={[
          // 搜索专属列:仅在 ProTable 搜索表单里出现,数据来自 params.keyword
          { title: "关键词", dataIndex: "keyword", hideInTable: true, fieldProps: { placeholder: "合同号 / 标题 / 客户名" } },
          {
            title: "含历史占位合同",
            dataIndex: "includeLegacyZeroAmount",
            hideInTable: true,
            valueType: "switch",
            initialValue: false,
            fieldProps: {
              // antd Switch 的 checked 会被 ProTable 转成 true / undefined, 后端 schema 接 zod string
              // 兼容 true / 1 即可; 默认 false 列表不显示 legacy 0.01 占位合同
              checkedChildren: "显示",
              unCheckedChildren: "隐藏"
            }
          },
          {
            // 客户区域级联 (省/市/区/镇街). changeOnSelect 让用户能停在任一级, 比如只选"浙江省"
            // dataIndex="region" 只是个虚拟字段 (后端不认), 真正传给 API 的是 request 回调拆出来的 province/city/district/town
            title: "客户区域",
            dataIndex: "region",
            hideInTable: true,
            valueType: "cascader",
            fieldProps: {
              options: regionOptions,
              placeholder: "省 / 市 / 区 / 镇街",
              allowClear: true,
              changeOnSelect: true,
              // hover 展开子级 + 单击任一级即选中并收起面板 (默认 click 展开时点中间级虽已选中
              // 但面板不收起, 容易被当成"不能选中间级"); 保证省/市/区/镇街每一级都能直接查询
              expandTrigger: "hover",
              showSearch: true
            }
          },
          {
            title: "合同号",
            dataIndex: "contractNo",
            search: false,
            width: 180,
            fixed: !isMobile ? "left" : undefined,
            render: (_, r) => <Link href={`/contracts/${r.id}`}>{r.contractNo}</Link>
          },
          { title: "客户", dataIndex: "customerName", search: false, width: 180 },
          {
            title: "客户区域",
            dataIndex: "customerProvince",
            search: false,
            // 4 级拼接 (省/市/区/镇街) 最长 ~28 个汉字, 与客户页"所在地区"列同宽
            width: 240,
            ellipsis: true,
            render: (_, r) => formatRegion(r.customerProvince, r.customerCity, r.customerDistrict, r.customerTown) || "—"
          },
          { title: "负责人", dataIndex: "ownerUserId", search: false, width: 110, render: (_, r) => r.ownerName || "—" },
          { title: "合同标题", dataIndex: "title", search: false, width: 240 },
          {
            title: "服务类型",
            dataIndex: "serviceType",
            search: false,
            width: 120,
            valueEnum: serviceTypeEnum,
            render: (_, r) => serviceTypeDict.find((d) => d.code === r.serviceType)?.label ?? r.serviceType
          },
          { title: "签订日", dataIndex: "signDate", search: false, valueType: "date", width: 120, render: (_, r) => <DateCell value={r.signDate} /> },
          { title: "总额(元)", dataIndex: "totalAmount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.totalAmount} /> },
          { title: "已开票(元)", dataIndex: "invoicedAmount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.invoicedAmount} /> },
          { title: "已回款(元)", dataIndex: "paidAmount", search: false, width: 140, render: (_, r) => <CurrencyCell value={r.paidAmount} /> },
          {
            title: "开票状态",
            dataIndex: "billingStatus",
            search: false,
            width: 110,
            render: (_, r) => {
              const color = r.billingStatus === "COMPLETED" ? "success" : r.billingStatus === "IN_PROGRESS" ? "processing" : "default";
              return <Tag color={color}>{BILLING_STATUS_MAP[r.billingStatus] ?? r.billingStatus}</Tag>;
            }
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="contract" />
          }
        ]}
        options={{
          density: !isMobile,
          fullScreen: !isMobile
        }}
      />
    </Page>
  );
}
