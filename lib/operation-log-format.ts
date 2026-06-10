import type { StatusDomain } from "@/lib/status";

export function actionDomain(action: string): StatusDomain | null {
  if (action.startsWith("CONTRACT_")) return "contract";
  if (action.startsWith("PROJECT_")) return "project";
  if (action.startsWith("INVOICE_")) return "invoice";
  if (action.startsWith("PAYMENT_")) return "payment";
  if (action.startsWith("CUSTOMER_")) return "customer";
  return null;
}

/** CONTRACT_SUBMIT -> SUBMIT, PAYMENT_CONFIRM -> CONFIRM */
export function shortAction(action: string): string {
  const idx = action.indexOf("_");
  return idx >= 0 ? action.slice(idx + 1) : action;
}
