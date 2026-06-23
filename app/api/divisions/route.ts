// GET /api/divisions  - 返回 4 级行政区划 (省/市/区/镇街) 树
// 设计点:
//  - 数据源: lib/china-divisions.ts (服务端引入, 不进 client bundle)
//  - value 字段用 label 而不是 code: 让前端 cascader 的 form value 就是 DB 里存的 label,
//    (e.g. 选 "浙江省/杭州市/西湖区" → form value = ["浙江省","杭州市","西湖区"]), 后端
//    listCustomers 直接用 equals 比对, 不用再做 code→label 转换
//  - 接口零鉴权读取: 行政区划是公开数据, 全员能拉; 客户端 SWR dedupe 60s
import { NextResponse } from "next/server";
import { DIVISIONS, type DivisionNode } from "@/lib/china-divisions";

type LabelNode = {
  value: string;
  label: string;
  children?: LabelNode[];
};

function toLabelTree(nodes: DivisionNode[]): LabelNode[] {
  return nodes.map((n) => ({
    value: n.label,
    label: n.label,
    children: n.children ? toLabelTree(n.children) : undefined
  }));
}

export async function GET() {
  return NextResponse.json(
    { code: 0, data: toLabelTree(DIVISIONS) },
    {
      headers: {
        // 行政区划几乎不变, 缓存 1 天, SWR 60s dedupe 是客户端那一层
        "Cache-Control": "public, max-age=86400, s-maxage=86400"
      }
    }
  );
}
