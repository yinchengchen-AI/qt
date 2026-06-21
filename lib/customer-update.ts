import type { Prisma } from "@prisma/client";
import type { CustomerUpdateInput } from "@/lib/validators/customer";

/**
 * 字符串型字段: 提交 "" 时归一为 null, 用于"清空该字段"语义。
 * 其它字段 (枚举 / 必填标识 / ID) 按原值透传。
 */
const STRINGABLE_NULLABLE: ReadonlyArray<keyof CustomerUpdateInput> = [
  "shortName",
  "unifiedSocialCreditCode",
  "industry",
  "scale",
  "address",
  "district",
  "town",
  "contactName",
  "contactTitle",
  "sourceChannel"
];

/**
 * 把 CustomerUpdateInput 拼成 Prisma.CustomerUpdateInput.
 * 仅含 input 中实际出现的字段 - 不在 input 里的字段不会进 data, Prisma 也就不会触碰 DB 中的旧值.
 * 现状 updateCustomer 直接 `...input, field: input.field || null` 会把没传的字段写成 null, 触发
 * "只想改 name 却把 shortName 擦掉" 的回归. 路由层会单独把 status 路由到 changeCustomerStatus,
 * 这里也再防御一次, 即便 input 里有 status 也不会被写入.
 */
export function buildCustomerUpdateData(
  input: CustomerUpdateInput,
  userId: string
): Prisma.CustomerUpdateInput {
  const data: Record<string, unknown> = { updatedById: userId };
  const has = (k: keyof CustomerUpdateInput) =>
    Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  if (has("name")) data.name = input.name;
  if (has("customerType")) data.customerType = input.customerType;
  if (has("province")) data.province = input.province;
  if (has("city")) data.city = input.city;
  if (has("contactPhone")) data.contactPhone = input.contactPhone;
  if (has("ownerUserId")) data.ownerUserId = input.ownerUserId;
  // status 走 changeCustomerStatus, 这里不写, 防止绕过 R-02 / R-13 业务规则

  for (const key of STRINGABLE_NULLABLE) {
    if (has(key)) {
      const v = input[key];
      data[key as string] = v === "" || v === undefined ? null : v;
    }
  }

  return data as Prisma.CustomerUpdateInput;
}
