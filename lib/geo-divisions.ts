/**
 * 杭州市最新行政区划数据
 * 来源：杭州市民政局 2024 年公告
 * - 12 个县级行政区：10 区 + 1 县级市 + 1 县
 * - 各区/县下辖街道、镇的名称列表
 *
 * 用途：customer 表单的省/市/区/街道级联下拉（用于区域统计）
 * 不在此范围内的客户地址保留自由文本（导入或老数据兼容）
 */
export const PROVINCE = "浙江省";
export const CITY = "杭州市";

export type District = {
  /** 民政部公布的区/县/县级市代码,简称 */
  code: string;
  /** 中文名,如 上城区 / 建德市 / 淳安县 */
  name: string;
  /** 街道 / 镇 列表 */
  streets: string[];
};

export const HANGZHOU_DISTRICTS: District[] = [
  {
    code: "shangcheng",
    name: "上城区",
    streets: [
      "湖滨街道", "清波街道", "小营街道", "望江街道", "南星街道", "紫阳街道",
      "闸弄口街道", "采荷街道", "凯旋街道", "丁兰街道", "九堡街道", "笕桥街道",
      "彭埠街道"
    ]
  },
  {
    code: "gongshu",
    name: "拱墅区",
    streets: [
      "米市巷街道", "湖墅街道", "小河街道", "拱宸桥街道", "和睦街道", "大关街道",
      "祥符街道", "上塘街道", "康桥街道", "半山街道", "皋亭街道", "崇贤街道",
      "塘河街道"
    ]
  },
  {
    code: "xihu",
    name: "西湖区",
    streets: [
      "北山街道", "西溪街道", "灵隐街道", "翠苑街道", "文新街道", "古荡街道",
      "转塘街道", "留下街道", "蒋村街道", "三墩街道", "双浦街道"
    ]
  },
  {
    code: "binjiang",
    name: "滨江区",
    streets: ["西兴街道", "长河街道", "浦沿街道"]
  },
  {
    code: "xiaoshan",
    name: "萧山区",
    streets: [
      "城厢街道", "北干街道", "蜀山街道", "新塘街道", "衙前镇", "瓜沥镇",
      "益农镇", "党湾镇", "楼塔镇", "河上镇", "戴村镇", "临浦镇", "义桥镇",
      "所前镇", "进化镇", "新街街道", "城南街道", "新湾街道"
    ]
  },
  {
    code: "yuhang",
    name: "余杭区",
    streets: [
      "南苑街道", "东湖街道", "星桥街道", "乔司街道", "运河街道", "塘栖镇",
      "仁和街道", "瓶窑镇", "径山镇", "黄湖镇", "鸬鸟镇", "百丈镇"
    ]
  },
  {
    code: "linping",
    name: "临平区",
    streets: [
      "临平街道", "南苑街道", "东湖街道", "星桥街道", "乔司街道", "运河街道",
      "崇贤街道", "塘栖镇"
    ]
  },
  {
    code: "qiantang",
    name: "钱塘区",
    streets: [
      "下沙街道", "白杨街道", "河庄街道", "义蓬街道", "新湾街道", "临江街道",
      "前进街道"
    ]
  },
  {
    code: "fuyang",
    name: "富阳区",
    streets: [
      "富春街道", "春江街道", "鹿山街道", "东洲街道", "银湖街道", "新登镇",
      "场口镇", "常安镇", "龙门镇", "里山镇", "渔山乡", "万市镇"
    ]
  },
  {
    code: "linan",
    name: "临安区",
    streets: [
      "锦城街道", "锦北街道", "锦南街道", "玲珑街道", "青山湖街道", "太湖源镇",
      "高虹镇", "於潜镇", "太阳镇", "潜川镇", "昌化镇", "龙岗镇", "河桥镇",
      "湍口镇", "清凉峰镇"
    ]
  },
  {
    code: "jiande",
    name: "建德市",
    streets: [
      "新安江街道", "更楼街道", "洋溪街道", "寿昌镇", "乾潭镇", "梅城镇",
      "杨村桥镇", "大同镇", "航头镇", "李家镇", "下涯镇", "莲花镇", "钦堂乡"
    ]
  },
  {
    code: "chunan",
    name: "淳安县",
    streets: [
      "千岛湖镇", "文昌镇", "石林镇", "临岐镇", "威坪镇", "汾口镇",
      "中洲镇", "大墅镇", "枫树岭镇", "姜家镇", "界首乡", "梓桐镇",
      "鸠坑乡", "屏门乡", "瑶山乡", "王阜乡", "左口乡", "宋村乡", "金峰乡", "富文乡"
    ]
  }
];

/** 全量转下拉选项 */
export const HANGZHOU_DISTRICT_OPTIONS = HANGZHOU_DISTRICTS.map((d) => ({
  value: d.code,
  label: d.name
}));

/** 找 code 对应的 name;找不到返回原值 */
export function districtName(code: string | null | undefined): string {
  if (!code) return "";
  return HANGZHOU_DISTRICTS.find((d) => d.code === code)?.name ?? code;
}

/** 给定 district code,返回该区下的街道选项;找不到返回空数组 */
export function streetOptionsFor(districtCode: string | null | undefined) {
  if (!districtCode) return [];
  const d = HANGZHOU_DISTRICTS.find((x) => x.code === districtCode);
  if (!d) return [];
  return d.streets.map((s) => ({ value: s, label: s }));
}
