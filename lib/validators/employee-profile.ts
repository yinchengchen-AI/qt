import { z } from "zod";
import { GENDER, EMPLOYMENT_TYPE } from "@/types/enums";

export function optionalString(max: number) {
  return z.string().max(max).optional().or(z.literal("").transform(() => undefined));
}

export function optionalDate() {
  return z.iso.datetime().optional().or(z.literal("").transform(() => undefined));
}

function isValidIdCard(v: string): boolean {
  if (!v) return true;

  // 18 位
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

  // 15 位（已废弃，仅做基础格式兼容）
  const fifteen = /^[1-9]\d{5}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}$/;
  return fifteen.test(v);
}

export const employeeProfileUpdateSchema = z.object({
  gender: z.enum(GENDER).optional().or(z.literal("").transform(() => undefined)),
  birthday: optionalDate(),
  idCard: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().max(18).optional().refine((v) => !v || isValidIdCard(v), { message: "身份证号格式错误" })
  ),
  education: optionalString(50),
  entryDate: optionalDate(),
  address: optionalString(200),
  emergencyContactName: optionalString(40),
  emergencyContactPhone: optionalString(20),

  position: optionalString(50),
  jobLevel: optionalString(50),
  employmentType: z.enum(EMPLOYMENT_TYPE).optional().or(z.literal("").transform(() => undefined)),
  probationEndDate: optionalDate(),
  formalDate: optionalDate(),
  resignationDate: optionalDate(),

  contractType: optionalString(50),
  contractStartDate: optionalDate(),
  contractEndDate: optionalDate(),

  salary: z.coerce.number().nonnegative().max(999999999999.99).optional().or(z.literal("").transform(() => undefined)),
  bankAccount: optionalString(40),
  bankName: optionalString(100),
  socialSecurityAccount: optionalString(40),
  providentFundAccount: optionalString(40),

  workExperience: optionalString(5000),
  educationHistory: optionalString(5000),
  certificates: optionalString(5000),
  remark: optionalString(5000)
});

export type EmployeeProfileUpdateInput = z.infer<typeof employeeProfileUpdateSchema>;
