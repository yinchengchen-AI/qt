// 清空所有业务数据，保留基础配置：Role / User / Department / Dictionary / Sequence
// 用法：
//   npx tsx scripts/shared/cleanup-business-data.ts         执行删除
//   npx tsx scripts/shared/cleanup-business-data.ts --dry-run  仅统计
import { prisma } from "@/lib/prisma";

const dryRun = process.argv.includes("--dry-run");

const TABLES = [
  { name: "InvoiceAuditLog", model: prisma.invoiceAuditLog },
  { name: "Payment", model: prisma.payment },
  { name: "Invoice", model: prisma.invoice },
  { name: "ContractReviewLog", model: prisma.contractReviewLog },
  { name: "Attachment", model: prisma.attachment },
  { name: "Contract", model: prisma.contract },
  { name: "ContactPerson", model: prisma.contactPerson },
  { name: "FollowUp", model: prisma.followUp },
  { name: "Customer", model: prisma.customer },
  { name: "OperationLog", model: prisma.operationLog },
  { name: "Message", model: prisma.message },
  { name: "Announcement", model: prisma.announcement }
] as const;

async function main() {
  console.log(dryRun ? "【预览模式】将删除以下业务数据：" : "【执行删除】开始清空业务数据...");

  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    counts[t.name] = await (t.model as any).count();
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const t of TABLES) {
    console.log(`  ${t.name}: ${counts[t.name]} 条`);
  }
  console.log(`  合计: ${total} 条`);

  if (dryRun) {
    console.log("\n预览结束，未执行删除。去掉 --dry-run 后正式执行。");
    return;
  }

  if (total === 0) {
    console.log("\n没有业务数据需要删除。");
    return;
  }

  const answer = await ask("\n确认删除以上所有业务数据？输入 yes 继续: ");
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("已取消。");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Invoice 自引用 linkedInvoiceId 需要先解引用
    await tx.invoice.updateMany({ data: { linkedInvoiceId: null } });

    // 按依赖顺序删除
    await tx.invoiceAuditLog.deleteMany();
    await tx.payment.deleteMany();
    await tx.invoice.deleteMany();
    await tx.contractReviewLog.deleteMany();
    await tx.attachment.deleteMany();
    await tx.contract.deleteMany();
    await tx.contactPerson.deleteMany();
    await tx.followUp.deleteMany();
    await tx.customer.deleteMany();
    await tx.operationLog.deleteMany();
    await tx.message.deleteMany();
    await tx.announcement.deleteMany();
  });

  console.log("\n业务数据已清空。保留 Role / User / Department / Dictionary / Sequence。");
}

function ask(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);
  return new Promise((resolve) => {
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (data) => {
      stdin.pause();
      resolve(String(data));
    });
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
