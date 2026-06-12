import { Card, Skeleton, Space } from "antd";

type Props = {
  /** 描述条目行数,默认 12 */
  rows?: number;
};

/** 详情页 loading 占位:页面标题 + 卡片 + 描述行,避免跳到居中 spinner。 */
export function DetailPageSkeleton({ rows = 12 }: Props) {
  return (
    <Space orientation="vertical" size={24} style={{ width: "100%" }}>
      <div>
        <Skeleton.Input active size="small" style={{ width: 120, marginBottom: 12 }} />
        <Skeleton.Input active size="large" style={{ width: 360, marginBottom: 12 }} />
        <Skeleton.Input active size="small" style={{ width: 520 }} />
      </div>

      <Card>
        <Skeleton active paragraph={{ rows }} />
      </Card>
    </Space>
  );
}

export default DetailPageSkeleton;
