// 浏览器端上传工具 - 走 presigned PUT 直传 MinIO
// 用法:
//   const res = await uploadFileToMinIO(file, { contractId });
//   const res = await uploadFileToMinIO(file, { invoiceId });
//   ProFormUploadButton 的 customRequest 里用 proCustomRequest({ message }) 包一下即可
export type UploadedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};

export type UploadOpts = { contractId?: string | null; invoiceId?: string | null };

export async function uploadFileToMinIO(file: File, opts: UploadOpts = {}): Promise<UploadedAttachment> {
  // 1. 调后端拿 PUT URL
  const presignRes = await fetch("/api/files/presign-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contractId: opts.contractId ?? null,
      invoiceId: opts.invoiceId ?? null
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

// antd Upload 组件的 customRequest 适配:
//   1) 调 uploadFileToMinIO
//   2) 成功:onSuccess({ status: "done", response: { id, name, mimeType, size, uploadedBy, uploadedAt } })
//      (ProForm 会把这个对象序列化进表单字段值)
//   3) 失败:onError(err) + antd message 弹错
// 用 any 适配 antd 内部 UploadRequestOption 的复杂类型(antd 的 xhr 形参
// 是 XMLHttpRequest | UploadRequestFile 联合类型,这里只需要一个占位 XHR;
// 自定义 customRequest 永远不读它)。
export function proCustomRequest(opts: UploadOpts = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- antd UploadRequestOption 的 onSuccess 签名是 (response, xhr)，调用方依赖 antd 类型拉进来会拆不完
  return (options: any): void => {
    const file = options.file as File | undefined;
    if (!file) {
      options.onError?.(new Error("空文件"));
      return;
    }
    // 异步执行(返回 void 即可,不要让 onSuccess 同步等 PUT 完成)
    void (async () => {
      try {
        const res = await uploadFileToMinIO(file, opts);
        options.onSuccess?.(res, new XMLHttpRequest());
      } catch (e) {
        const err = e as Error;
        options.onError?.(err);
        // 错误提示由调用方(ProForm 页面)用 AntdApp.useApp().message.error 弹
      }
    })();
  };
}
