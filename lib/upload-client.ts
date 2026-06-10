// 浏览器端上传工具 — 走 presigned PUT 直传 MinIO
// 用法:ProFormUploadButton 的 customRequest 里 await uploadFileToMinIO(file)
export type UploadedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};

export async function uploadFileToMinIO(
  file: File,
  opts?: { contractId?: string | null }
): Promise<UploadedAttachment> {
  // 1. 调后端拿 PUT URL
  const presignRes = await fetch("/api/files/presign-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contractId: opts?.contractId ?? null
    })
  });
  if (!presignRes.ok) {
    const t = await presignRes.text();
    throw new Error(`presign 失败: ${presignRes.status} ${t.slice(0, 200)}`);
  }
  const presign = (await presignRes.json()) as {
    code: number;
    data: { attachmentId: string; url: string; objectKey: string; expiresAt: string };
  };
  if (presign.code !== 0) {
    throw new Error("presign 返回非成功 code");
  }
  const { attachmentId, url } = presign.data;

  // 2. PUT 到 MinIO(走 fetch,无 CORS 预检干扰)
  const putRes = await fetch(url, {
    method: "PUT",
    body: file,
    credentials: "omit"
  });
  if (!putRes.ok) {
    throw new Error(`上传到 MinIO 失败: ${putRes.status} ${putRes.statusText}`);
  }

  return {
    id: attachmentId,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    uploadedBy: "self", // 服务端实际是登录用户;这里仅供表单占位
    uploadedAt: new Date().toISOString()
  };
}
