import { z } from "zod";
import { GENDER, EMPLOYMENT_TYPE } from "@/types/enums";

export function optionalString(max: number) {
  return z.string().max(max).optional().or(z.literal("").transform(() => undefined));
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
    z.string().max(18).optional().refine((v) => !v || isValidIdCard(v), { message: "身份证号格式错误" })
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
  salary: z.coerce.number().nonnegative().max(999999999999.99).optional().or(z.literal("").transform(() => undefined)),
  bankAccount: optionalString(40),
  bankName: optionalString(100),
  socialSecurityAccount: optionalString(40),
  providentFundAccount: optionalString(40),

  // 备注(保留)
  remark: optionalString(5000)
});

export type EmployeeProfileUpdateInput = z.infer<typeof employeeProfileUpdateSchema>;
