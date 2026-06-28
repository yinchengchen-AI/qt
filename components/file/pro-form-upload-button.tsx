"use client";
// 在 ProFormUploadButton 基础上,接上 FilePreviewModal,解决"上传后点击无法预览 PDF/Office 等非图片文件"的 bug
// (ProFormUploadButton 内置的 onPreview 只对图片做 base64 预览,非图片文件点开会打开一个空的 antd Image 蒙层)
import { ProFormUploadButton } from "@ant-design/pro-components";
import { useState } from "react";
import { FilePreviewModal, type PreviewableAttachment } from "./file-preview-modal";

// antd Upload 组件 onPreview 回调收到的文件对象(我们只需要其中几个字段)
type UploadedItem = {
  uid?: string;
  name?: string;
  type?: string;
  size?: number;
  // 我们在 proCustomRequest 的 onSuccess 里塞进去的 { id, name, mimeType, size, uploadedBy, uploadedAt }
  response?: { id?: string; name?: string; mimeType?: string; size?: number };
};

// 透传 ProFormUploadButton 的所有 props,只在 fieldProps 上注入我们自己的 onPreview
export function PreviewableProFormUploadButton(
  props: React.ComponentProps<typeof ProFormUploadButton>
) {
  const [preview, setPreview] = useState<PreviewableAttachment | null>(null);
  const handlePreview = (file: UploadedItem) => {
    const id = file.response?.id;
    if (!id) {
      // 上传未完成或失败时不处理
      return;
    }
    setPreview({
      id,
      name: file.response?.name ?? file.name ?? "未命名",
      mimeType: file.response?.mimeType ?? file.type,
      size: file.response?.size ?? file.size
    });
  };
  return (
    <>
      <ProFormUploadButton
        {...props}
        fieldProps={{
          ...(props.fieldProps ?? {}),
          onPreview: handlePreview
        }}
      />
      <FilePreviewModal attachment={preview} onClose={() => setPreview(null)} />
    </>
  );
}
