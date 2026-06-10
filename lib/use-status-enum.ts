"use client";
import { formatStatus, getStatusOptions, type StatusDomain } from "@/lib/status";

/** 形如 { DRAFT: { text: '草稿', status: 'Default' } };供 ProTable valueEnum 使用 */
export function useStatusValueEnum(domain: StatusDomain): Record<string, { text: string; status: string }> {
  const out: Record<string, { text: string; status: string }> = {};
  for (const { value, label } of getStatusOptions(domain)) {
    out[value] = { text: label, status: "Default" };
  }
  return out;
}

/** 形如 [{ value, label }];供 ProFormSelect / Select 使用 */
export function useStatusOptions(
  domain: StatusDomain,
  filter?: (code: string) => boolean
): { value: string; label: string }[] {
  return getStatusOptions(domain, filter);
}

export { formatStatus };
