import { Card, Form, Skeleton } from "antd";

type Props = {
  /** 表单行数,默认 8 */
  rows?: number;
};

/** 新建 / 编辑页 loading 占位:让表单骨架可见,避免切换到居中 spinner 引起的布局跳动。 */
export function FormPageSkeleton({ rows = 8 }: Props) {
  return (
    <Card>
      <Form layout="vertical">
        {Array.from({ length: rows }).map((_, i) => (
          <Form.Item key={i} label={<Skeleton.Input active size="small" style={{ width: 80 }} />}>
            <Skeleton.Input active size="large" style={{ width: "100%" }} block />
          </Form.Item>
        ))}
      </Form>
    </Card>
  );
}

export default FormPageSkeleton;
