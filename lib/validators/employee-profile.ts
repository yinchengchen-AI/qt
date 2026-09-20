import { z } from "zod";
import { GENDER, EMPLOYMENT_TYPE } from "@/types/enums";

export function optionalString(max: number) {
  return z.string().max(max).optional().or(z.literal("").transform(() => undefined));
}

// 敏感字符串字段(银行卡/开户行/社保/公积金)额外接受 null = 显式清空,
// 与 salary/idCard 的清空语义对齐;其余 optionalString 字段(地址/岗位等)维持
// "null 拒绝,前端须剔除"的原契约(见 user-with-profile validator 测试)。
export function nullableOptionalString(max: number) {
  return z.string().max(max).nullish().or(z.literal("").transform(() => undefined));
}

export function optionalDate() {
  return z.union([z.iso.datetime(), z.iso.date()]).optional().or(z.literal("").transform(() => undefined));
}

export function isoDateOrDateTime() {
  return z.union([z.iso.datetime(), z.iso.date()]);
}

function isValidIdCard(v: string): boolean {
  if (!v) return true;
  const eighteen = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
  if (eighteen.test(v)) {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += parseInt(v[i]!, 10) * weights[i]!;
    }
    const expected = checkCodes[sum % 11];
    const actual = v[17]!.toUpperCase();
    return expected === actual;
  }
  return false;
}

// PR3:删 workExperience/educationHistory/certificates/address/emergencyContactName+Phone,加省市区 + avatarAttachmentId
export const employeeProfileUpdateSchema = z.object({
  // 基础
  gender: z.enum(GENDER).optional().or(z.literal("").transform(() => undefined)),
  birthday: optionalDate(),
  idCard: z.preprocess(
    (val) => (val === "" ? undefined : val),
    // null = 显式清除已存身份证号(随机 IV 加密使 @unique 无法防重,应用层查重见 service)
    z.string().max(18).nullish().refine((v) => !v || isValidIdCard(v), { message: "身份证号格式错误" })
  ),
  education: optionalString(50),
  entryDate: optionalDate(),

  // 住址(结构化)
  province: optionalString(50),
  city: optionalString(50),
  district: optionalString(50),
  addressDetail: optionalString(200),

  // 人事/岗位
  position: optionalString(50),
  jobLevel: optionalString(50),
  employmentType: z.enum(EMPLOYMENT_TYPE).optional().or(z.literal("").transform(() => undefined)),
  probationEndDate: optionalDate(),
  formalDate: optionalDate(),
  resignationDate: optionalDate(),

  // 合同
  contractType: optionalString(50),
  contractStartDate: optionalDate(),
  contractEndDate: optionalDate(),

  // 头像
  avatarAttachmentId: z.string().min(1).nullable().optional(),

  // 敏感
  // union 顺序敏感: "" → undefined(不变), null → 显式清空, 数字/数字字符串 → 写入。
  // 不能用 coerce 兜底(Number(null)/Number("") 都是 0,会把"清空"变成"月薪 0")。
  salary: z
    .union([
      z.literal("").transform(() => undefined),
      z.null(),
      z.coerce.number().nonnegative().max(999999999999.99)
    ])
    .optional(),
  bankAccount: nullableOptionalString(40),
  bankName: nullableOptionalString(100),
  socialSecurityAccount: nullableOptionalString(40),
  providentFundAccount: nullableOptionalString(40),

  // 备注(保留)
  remark: optionalString(5000)
});

export type EmployeeProfileUpdateInput = z.infer<typeof employeeProfileUpdateSchema>;
