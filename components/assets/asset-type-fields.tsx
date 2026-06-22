// 8 种 type 的 ProForm 字段组件(集中在一个文件)
// 每个组件使用 2 列网格(通过 FormGrid),让字段更紧凑、相关字段并列
// 关键链接:
//   - PERFORMANCE:customer + contract 双向 picker,选合同后自动回填服务类型/金额/日期
//   - CASE:项目名称手工录入 + 合同 picker 回填客户/服务类型
import { useMemo, useState } from "react";
import {
  ProForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSelect,
  ProFormDateTimePicker
} from "@ant-design/pro-components";
import { Form, Input, InputNumber } from "antd";
import dayjs from "dayjs";
import { FormGrid } from "@/components/form";
import { useDict, groupDictByLegacy } from "@/lib/dict-client";
import { PreviewableProFormUploadButton as UploadButton } from "@/components/file/pro-form-upload-button";
import { proCustomRequest } from "@/lib/upload-client";

export function LicenseFields() {
  return (
    <FormGrid columns={2}>
      <ProFormText name={["attributes", "unifiedSocialCreditCode"]} label="统一社会信用代码" rules={[{ required: true, message: "请填写 18 位统一社会信用代码" }]} tooltip="格式示例:91110000600037341L" />
      <ProFormText name={["attributes", "legalRepresentative"]} label="法定代表人" rules={[{ required: true, message: "请填写法定代表人" }]} />
      <ProFormText name={["attributes", "registeredCapital"]} label="注册资本" rules={[{ required: true }]} tooltip="示例:1000万 / ¥1000 万" />
      <ProFormDateTimePicker name={["attributes", "establishDate"]} label="成立日期" rules={[{ required: true }]} />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormTextArea name={["attributes", "businessScope"]} label="经营范围" fieldProps={{ rows: 2, maxLength: 2000, showCount: true }} rules={[{ required: true }]} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormText name={["attributes", "address"]} label="注册地址" rules={[{ required: true }]} />
      </div>
    </FormGrid>
  );
}

export function CertificateFields() {
  return (
    <FormGrid columns={2}>
      <ProFormText name={["attributes", "certificateNo"]} label="证书编号" rules={[{ required: true }]} />
      <ProFormText name={["attributes", "issuingAuthority"]} label="颁发机构" rules={[{ required: true }]} />
      <ProFormSelect
        name={["attributes", "gradeLevel"]}
        label="等级"
        options={[{ value: "甲级", label: "甲级" }, { value: "乙级", label: "乙级" }, { value: "丙级", label: "丙级" }]}
        allowClear
      />
      <ProFormText name={["attributes", "category"]} label="资质类别" rules={[{ required: true }]} placeholder="例:安全评价 / 检测检验" />
    </FormGrid>
  );
}

export function QualificationFields() {
  return (
    <FormGrid columns={2}>
      <ProFormSelect
        name={["attributes", "standard"]}
        label="标准"
        rules={[{ required: true }]}
        options={[
          { value: "ISO9001", label: "ISO 9001 质量" },
          { value: "ISO14001", label: "ISO 14001 环境" },
          { value: "ISO45001", label: "ISO 45001 职业健康" },
          { value: "ISO27001", label: "ISO 27001 信息安全" },
          { value: "ISO50001", label: "ISO 50001 能源" },
          { value: "OTHER", label: "其他" }
        ]}
      />
      <ProFormText name={["attributes", "certificateNo"]} label="证书编号" rules={[{ required: true }]} />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormText name={["attributes", "issuingAuthority"]} label="认证机构" rules={[{ required: true }]} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormTextArea name={["attributes", "scope"]} label="认证范围" fieldProps={{ rows: 2, maxLength: 2000, showCount: true }} />
      </div>
    </FormGrid>
  );
}

/** 客户 picker:模糊搜索 /api/customers,过滤为洽谈中/已签约;选中后回填 name/contact */
function CustomerPicker({ name, label = "客户", required = true }: { name: [string, string]; label?: string; required?: boolean }) {
  const form = Form.useFormInstance();
  return (
    <ProFormSelect
      name={name}
      label={label}
      placeholder="输入客户名/编号搜索"
      showSearch
      allowClear
      rules={required ? [{ required: true, message: `请选择${label}` }] : []}
      fieldProps={{
        optionFilterProp: "label",
        showSearch: true,
        filterOption: false  // 服务端搜索
      }}
      request={async ({ keyWords }: { keyWords?: string }) => {
        const qs = new URLSearchParams();
        qs.set("pageSize", "50");
        qs.set("keyword", keyWords ?? "");
        const r = await fetch(`/api/customers?${qs}`, { credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) return [];
        return (j.data.list as Array<{ id: string; code: string; name: string; contactName?: string | null; contactPhone?: string; status: string }>)
          .filter((c) => ["NEGOTIATING", "SIGNED"].includes(c.status))
          .map((c) => ({
            value: c.id,
            label: `${c.code} · ${c.name}`,
            // 业务字段(供 onChange 回填)
            customerName: c.name,
            customerContact: `${c.contactName ?? ""} ${c.contactPhone ?? ""}`.trim()
          }));
      }}
      onChange={(_value, option) => {
        const opt = option as { customerName?: string; customerContact?: string } | undefined;
        if (!opt) {
          // 清空客户时也清下游
          form?.setFieldsValue({
            "attributes.customerName": undefined,
            "attributes.customerContact": undefined,
            "attributes.contractId": undefined,
            "attributes.serviceType": undefined,
            "attributes.contractAmount": undefined,
            "attributes.signDate": undefined,
            "attributes.completedDate": undefined
          });
          return;
        }
        // 选中客户时:回填 name/contact,同时清掉合同及合同回填字段
        // (切客户必然清合同,避免孤儿引用)
        form?.setFieldsValue({
          "attributes.customerName": opt.customerName,
          "attributes.customerContact": opt.customerContact,
          "attributes.contractId": undefined,
          "attributes.serviceType": undefined,
          "attributes.contractAmount": undefined,
          "attributes.signDate": undefined,
          "attributes.completedDate": undefined
        });
      }}
    />
  );
}

/** 合同 picker:按 customerId 过滤,关键词搜合同号/标题;选中后回填服务类型/金额/日期 */
function ContractPicker({
  name,
  customerId,
  label = "关联合同",
  onContractPicked
}: {
  name: [string, string];
  customerId?: string;
  label?: string;
  /** 选中后通知父组件合同的 totalAmount(供合同金额字段强约束) */
  onContractPicked?: (amount: number | null) => void;
}) {
  const form = Form.useFormInstance();
  return (
    <ProFormSelect
      name={name}
      label={label}
      placeholder={customerId ? "输入合同号/标题搜索" : "请先选择客户"}
      showSearch
      allowClear
      disabled={!customerId}
      fieldProps={{
        optionFilterProp: "label",
        showSearch: true,
        filterOption: false
      }}
      dependencies={["attributes", "customerId"]}
      request={async ({ keyWords }: { keyWords?: string }) => {
        if (!customerId) return [];
        const qs = new URLSearchParams();
        qs.set("pageSize", "50");
        qs.set("customerId", customerId);
        qs.set("status", "ACTIVE,CLOSED");
        if (keyWords) qs.set("keyword", keyWords);
        const r = await fetch(`/api/contracts?${qs}`, { credentials: "include" });
        const j = await r.json();
        if (j.code !== 0) return [];
        return (j.data.list as Array<{
          id: string; contractNo: string; title: string;
          serviceType: string; totalAmount: string | number | { toString(): string }; signDate: string; endDate: string;
        }>).map((c) => ({
          value: c.id,
          label: `${c.contractNo} · ${c.title}`,
          serviceType: c.serviceType,
          contractAmount: Number(c.totalAmount),
          signDate: c.signDate,
          completedDate: c.endDate
        }));
      }}
      onChange={(_value, option) => {
        const opt = option as {
          serviceType?: string;
          contractAmount?: number;
          signDate?: string;
          completedDate?: string;
        } | undefined;
        if (!opt) {
          // 清合同时也清下游回填字段
          form?.setFieldsValue({
            "attributes.serviceType": undefined,
            "attributes.contractAmount": undefined,
            "attributes.signDate": undefined,
            "attributes.completedDate": undefined
          });
          // 清合同也清父组件的 contractTotalAmount,释放锁定
          onContractPicked?.(null);
          return;
        }
        // serviceType 只在用户未主动选过时回填(避免覆盖)
        const curServiceType = form?.getFieldValue(["attributes", "serviceType"]);
        const patch: Record<string, unknown> = {};
        if (opt.serviceType && !curServiceType) patch["attributes.serviceType"] = opt.serviceType;
        if (opt.contractAmount != null) patch["attributes.contractAmount"] = opt.contractAmount;
        if (opt.signDate) patch["attributes.signDate"] = dayjs(opt.signDate);
        if (opt.completedDate) patch["attributes.completedDate"] = dayjs(opt.completedDate);
        if (Object.keys(patch).length > 0) {
          form?.setFieldsValue(patch);
        }
        // 通知父组件合同的 totalAmount(供合同金额字段强约束)
        onContractPicked?.(typeof opt.contractAmount === "number" ? opt.contractAmount : null);
      }}
    />
  );
}

export function PerformanceFields() {
  const dictList = useDict("SERVICE_TYPE");
  const serviceTypeOptions = useMemo(() => groupDictByLegacy(dictList), [dictList]);
  // 用 onChange 回调(在 CustomerPicker/ContractPicker 内部)实现回填
  const form = Form.useFormInstance();
  const customerId = Form.useWatch(["attributes", "customerId"], form) as string | undefined;
  // 业绩证明强约束:选合同后合同金额 = contract.totalAmount,字段锁住
  const [contractTotalAmount, setContractTotalAmount] = useState<number | null>(null);
  return (
    <FormGrid columns={2}>
      <CustomerPicker name={["attributes", "customerId"]} />
      <ContractPicker
        name={["attributes", "contractId"]}
        customerId={customerId}
        onContractPicked={(amt) => setContractTotalAmount(amt)}
      />
      <ProFormText
        name={["attributes", "projectName"]}
        label="项目名称"
        tooltip="业绩对应的具体项目名(如:某化工集团 2023 年度安全评估)"
        rules={[{ required: true, message: "请填写项目名称" }]}
      />
      <ProFormText
        name={["attributes", "customerName"]}
        label="客户名称"
        tooltip="客户名称,可手工填写"
        rules={[{ required: true, message: "请填写客户名称" }]}
      />
      <ProFormText
        name={["attributes", "customerContact"]}
        label="客户联系方式"
        placeholder="姓名 / 电话"
      />
      <ProFormSelect
        name={["attributes", "serviceType"]}
        label="服务类型"
        tooltip="从合同自动回填,可手工覆盖"
        rules={[{ required: true, message: "请选择服务类型" }]}
        options={serviceTypeOptions}
        showSearch
      />
      <ProFormDigit
        name={["attributes", "contractAmount"]}
        label={contractTotalAmount != null ? "合同金额(元) · 来自所选合同" : "合同金额(元)"}
        tooltip={
          contractTotalAmount != null
            ? `选了合同后,业绩金额必须等于合同金额 ¥${contractTotalAmount.toLocaleString()}`
            : "未选合同时可自由填写;选了合同后会被锁定"
        }
        min={0}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rules={contractTotalAmount != null ? [(_rule: any, _value: any) => ({
          validator(_r: unknown, value: unknown) {
            if (value == null) return Promise.resolve();
            if (Number(value) !== contractTotalAmount) {
              return Promise.reject(new Error(`业绩金额必须等于合同金额(¥${contractTotalAmount!.toLocaleString()})`));
            }
            return Promise.resolve();
          }
        })] : []}
        fieldProps={{
          prefix: "¥",
          style: { width: "100%" },
          // 选了合同就锁住,避免用户输入不一致金额
          disabled: contractTotalAmount != null,
          // disabled 会让 ProFormDigit 不显示值;加 readOnly 兜底
          readOnly: contractTotalAmount != null
        }}
      />
      <ProFormDateTimePicker
        name={["attributes", "signDate"]}
        label="签订日期"
        tooltip="从合同自动回填"
      />
      <ProFormDateTimePicker
        name={["attributes", "completedDate"]}
        label="完成日期"
        tooltip="从合同自动回填"
      />
    </FormGrid>
  );
}

export function TeamMemberFields() {
  return (
    <FormGrid columns={2}>
      <ProFormText name={["attributes", "userId"]} label="内部员工 ID(可选)" tooltip="填写则自动关联到现有员工" />
      <ProFormText name={["attributes", "externalName"]} label="外部姓名(可选)" tooltip="未填 userId 时必填" />
      <ProFormText name={["attributes", "externalPhone"]} label="外部电话" />
      <ProFormText name={["attributes", "title"]} label="职称/职务" rules={[{ required: true }]} />
      <ProFormText name={["attributes", "specialty"]} label="专业方向" rules={[{ required: true }]} />
      <ProForm.Item
        name={["attributes", "yearsOfExperience"]}
        label="从业年限"
        rules={[{ required: true, message: "请填写从业年限" }]}
      >
        <InputNumber min={0} max={70} style={{ width: "100%" }} />
      </ProForm.Item>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProForm.Item name={["attributes", "resumeMarkdown"]} label="简历(Markdown)">
          <Input.TextArea rows={5} placeholder="支持 Markdown 语法" />
        </ProForm.Item>
      </div>
    </FormGrid>
  );
}


export function CaseFields() {
  const dictList = useDict("SERVICE_TYPE");
  const serviceTypeOptions = useMemo(() => groupDictByLegacy(dictList), [dictList]);
  return (
    <FormGrid columns={2}>
      <ProFormText
        name={["attributes", "title"]}
        label="案例标题"
        tooltip="从项目自动回填,可手工覆盖"
        rules={[{ required: true }]}
      />
      <ProFormText
        name={["attributes", "customerName"]}
        label="客户名称"
        tooltip="客户名称,可手工填写"
        rules={[{ required: true }]}
      />
      <ProFormSelect
        name={["attributes", "serviceType"]}
        label="服务类型"
        tooltip="服务类型,可手工选择"
        rules={[{ required: true }]}
        options={serviceTypeOptions}
        showSearch
      />
      <ProForm.Item
        name={["attributes", "year"]}
        label="年份"
        tooltip="项目年份,可手工填写"
        rules={[{ required: true, message: "请填写年份" }]}
      >
        <InputNumber min={2000} max={2100} style={{ width: "100%" }} />
      </ProForm.Item>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormTextArea name={["attributes", "scope"]} label="项目内容" fieldProps={{ rows: 2, maxLength: 2000, showCount: true }} rules={[{ required: true }]} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormTextArea name={["attributes", "highlights"]} label="项目亮点" fieldProps={{ rows: 3, maxLength: 5000, showCount: true }} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormTextArea name={["attributes", "result"]} label="项目结果" fieldProps={{ rows: 2, maxLength: 2000, showCount: true }} />
      </div>
    </FormGrid>
  );
}

export function PatentFields() {
  return (
    <FormGrid columns={2}>
      <ProFormSelect
        name={["attributes", "patentType"]}
        label="类型"
        rules={[{ required: true }]}
        options={[
          { value: "PATENT", label: "专利" },
          { value: "SOFTWARE_COPYRIGHT", label: "软件著作权" }
        ]}
      />
      <ProFormText name={["attributes", "patentNo"]} label="专利/软著号" rules={[{ required: true }]} />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProFormText name={["attributes", "name"]} label="名称" rules={[{ required: true }]} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <ProForm.Item
          name={["attributes", "applicants"]}
          label="申请人(逗号分隔)"
          rules={[{ required: true, message: "申请人至少 1 个" }]}
        >
          <Input placeholder="多个申请人用逗号或分号分隔" />
        </ProForm.Item>
      </div>
      <ProFormDateTimePicker name={["attributes", "applicationDate"]} label="申请日期" rules={[{ required: true }]} />
      <ProFormDateTimePicker name={["attributes", "grantDate"]} label="授权日期" />
    </FormGrid>
  );
}

export function OtherFields() {
  return (
    <ProFormTextArea name={["attributes", "freeText"]} label="自由文本" fieldProps={{ rows: 4, maxLength: 5000, showCount: true }} />
  );
}

export function PersonnelCertFields() {
  const dictList = useDict("PERSONNEL_CERT_TYPE");
  const certTypeOptions = useMemo(
    () => dictList.map((d) => ({ value: d.code, label: d.label })),
    [dictList]
  );
  return (
    <FormGrid columns={2}>
      <ProFormText
        name={["attributes", "userId"]}
        label="内部员工 ID"
        tooltip="从员工 picker 选入;必须指向 ACTIVE 状态的 User"
        rules={[{ required: true, message: "请选择内部员工" }]}
        placeholder="如:user-001"
      />
      <ProFormSelect
        name={["attributes", "certificateType"]}
        label="证书类型"
        options={certTypeOptions}
        rules={[{ required: true, message: "请选择证书类型" }]}
        showSearch
      />
      <ProFormText
        name={["attributes", "certificateNo"]}
        label="证书编号"
        rules={[{ required: true, message: "请填写证书编号" }]}
      />
      <ProFormText
        name={["attributes", "issuingAuthority"]}
        label="颁发机构"
        rules={[{ required: true, message: "请填写颁发机构" }]}
      />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProForm.Item
          name={["attributes", "scanFileId"]}
          label="证书扫描件"
          tooltip="支持 PDF / 图片;新建时上传到 tmp/ 路径,保存后自动绑定到该资产"
          rules={[{ required: true, message: "请上传证书扫描件" }]}
        >
          <UploadButton
            name="scanFileId"
            label="证书扫描件"
            max={1}
            fieldProps={{
              name: "file",
              listType: "text",
              // 新建阶段 assetId 尚未生成,先传 null 落到 tmp/;创建后 service 会回填 assetId
              customRequest: proCustomRequest({ assetId: null })
            }}
          />
        </ProForm.Item>
      </div>
    </FormGrid>
  );
}

export function TemplateFields() {
  const dictList = useDict("SERVICE_TYPE");
  const serviceTypeOptions = useMemo(() => groupDictByLegacy(dictList), [dictList]);
  return (
    <FormGrid columns={2}>
      <ProFormSelect
        name={["attributes", "serviceType"]}
        label="服务类型(可选)"
        tooltip="留空表示通用模板;填写后限定该模板只用于此服务类型"
        options={serviceTypeOptions}
        allowClear
        showSearch
      />
      <ProFormSelect
        name="tags"
        label="标签"
        mode="tags"
        fieldProps={{
          tokenSeparators: [",", "，", ";", "；"],
          placeholder: "如:投标函/报价单/授权书"
        }}
      />
      <div style={{ gridColumn: "1 / -1" }}>
        <ProForm.Item
          name={["attributes", "templateFileId"]}
          label="模板文件"
          rules={[{ required: true, message: "请上传模板文件" }]}
        >
          <UploadButton
            name="templateFileId"
            label="模板文件"
            max={1}
            fieldProps={{
              name: "file",
              listType: "text",
              customRequest: proCustomRequest({ assetId: null })
            }}
          />
        </ProForm.Item>
      </div>
    </FormGrid>
  );
}

const TYPE_FIELDS: Record<string, () => React.JSX.Element> = {
  LICENSE: LicenseFields,
  CERTIFICATE: CertificateFields,
  QUALIFICATION: QualificationFields,
  PERFORMANCE: PerformanceFields,
  TEAM_MEMBER: TeamMemberFields,
  CASE: CaseFields,
  PATENT: PatentFields,
  OTHER: OtherFields,
  // v1 标书素材库新增
  PERSONNEL_CERT: PersonnelCertFields,
  TEMPLATE: TemplateFields
};

export function AssetTypeFields({ type }: { type?: string }) {
  const Cmp = type ? TYPE_FIELDS[type] : null;
  if (!Cmp) return null;
  return <Cmp />;
}
