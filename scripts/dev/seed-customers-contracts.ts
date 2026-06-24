import "dotenv/config";
import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { createCustomer, changeCustomerStatus } from "@/server/services/customer";
import { createContract } from "@/server/services/contract";
import { getS3Client, getBucket } from "@/server/storage/minio";
import { isMinioEnabled } from "@/lib/env";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import type { CustomerCreateInput } from "@/lib/validators/customer";
import type { ContractCreateInput } from "@/lib/validators/contract";

const COUNT = 5;

async function getAdminUser(): Promise<SessionUser> {
  const admin = await prisma.user.findFirst({
    where: { deletedAt: null, status: "ACTIVE", isSystem: false },
    include: { role: true },
    orderBy: { createdAt: "asc" }
  });
  if (!admin) throw new Error("找不到可用用户，请先运行 seed:dev-users");
  return {
    id: admin.id,
    employeeNo: admin.employeeNo,
    name: admin.name,
    email: admin.email,
    roleCode: admin.role.code as SessionUser["roleCode"],
    permissions: ROLE_PERMISSIONS[admin.role.code as keyof typeof ROLE_PERMISSIONS] ?? []
  };
}

async function getServiceType(): Promise<string> {
  const dict = await prisma.dictionary.findFirst({
    where: { category: "SERVICE_TYPE", isActive: true },
    orderBy: { sort: "asc" }
  });
  if (!dict) throw new Error("找不到 SERVICE_TYPE 字典，请先运行 seed-dicts");
  return dict.code;
}

async function uploadTmpAttachment(userId: string, index: number) {
  if (!isMinioEnabled()) {
    throw new Error("MinIO 未配置，无法上传附件");
  }
  const client = getS3Client();
  const bucket = getBucket();
  const content = Buffer.from(`这是第 ${index + 1} 份示例合同附件\n`, "utf-8");
  const objectKey = `seed/${Date.now()}-${index}-${randomUUID()}.txt`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: content,
      ContentType: "text/plain"
    })
  );

  const attachment = await prisma.attachment.create({
    data: {
      objectKey,
      bucket,
      originalName: `示例附件-${index + 1}.txt`,
      mimeType: "text/plain",
      size: content.length,
      uploadedById: userId,
      uploadedAt: new Date()
    }
  });

  return {
    id: attachment.id,
    name: attachment.originalName,
    url: undefined,
    mimeType: attachment.mimeType,
    size: attachment.size,
    uploadedBy: attachment.uploadedById,
    uploadedAt: attachment.uploadedAt.toISOString()
  };
}

async function main() {
  const admin = await getAdminUser();
  const serviceType = await getServiceType();
  const now = new Date();
  const signDate = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();
  const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 20).toISOString();
  const endDate = new Date(now.getFullYear() + 1, now.getMonth(), 20).toISOString();

  const results: { customer: { id: string; code: string; name: string }; contract: { id: string; contractNo: string; title: string; status: string | null } }[] = [];

  for (let i = 0; i < COUNT; i++) {
    const suffix = `${Date.now()}-${i}`;
    const customerInput: CustomerCreateInput = {
      name: `示例客户-${i + 1}-${suffix.slice(-6)}`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactName: `联系人-${i + 1}`,
      contactPhone: `1380013800${i}`,
      address: "杭州市余杭区示例路 1 号"
    };

    const customer = await createCustomer(admin, customerInput);
    await changeCustomerStatus(admin, customer.id, "NEGOTIATING");

    const attachment = await uploadTmpAttachment(admin.id, i);

    const contractInput: ContractCreateInput = {
      customerId: customer.id,
      contractNo: `SEED-HT-${suffix}`,
      title: `示例合同-${i + 1}`,
      serviceType,
      signDate,
      startDate,
      endDate,
      totalAmount: 100000 + i * 10000,
      taxRate: 0.06,
      paymentMethod: "LUMP_SUM",
      attachments: [attachment]
    };

    const contract = await createContract(admin, contractInput);
    // createContract 把附件绑定为通用合同附件;业绩证明需要交付物(isDeliverable=true),所以标记一下
    await prisma.attachment.update({
      where: { id: attachment.id },
      data: { isDeliverable: true }
    });
    await changeCustomerStatus(admin, customer.id, "SIGNED");

    results.push({
      customer: { id: customer.id, code: customer.code, name: customer.name },
      contract: { id: contract!.id, contractNo: contract!.contractNo, title: contract!.title, status: contract!.status }
    });

    console.log(`✓ ${i + 1}/${COUNT} 客户 ${customer.code} → 合同 ${contract!.contractNo} (${contract!.status})`);
  }

  console.log("\n生成完成：");
  for (const r of results) {
    console.log(`  客户 ${r.customer.name} (${r.customer.code}) → 合同 ${r.contract.contractNo} [${r.contract.status}]`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
