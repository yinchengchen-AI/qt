// GB 32100-2015 统一社会信用代码 校验
// 18 位，第 1 位登记管理部门代码（1=机构编制/5=民政/9=工商/Y=其它），第 2 位机构类别，
// 第 3-8 位登记管理机关行政区划码（6 位），第 9-17 位主体标识码（9 位），第 18 位校验码。

const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const;
const ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY" as const;

export function isValidCreditCode(code: string): boolean {
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = code[i]!;
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return false;
    sum += v * WEIGHTS[i]!;
  }
  const check = (31 - (sum % 31)) % 31;
  return ALPHABET[check] === code[17];
}
