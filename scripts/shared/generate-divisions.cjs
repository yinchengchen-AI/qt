/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");
const _m = require("china-area-data");
const m = _m.default || _m;
const provinces = m["86"];
const tree = [];

const MUNICIPALITY_CODES = ["110000", "120000", "310000", "500000"];

// ===== 杭州市最新区划（2024）=====
// 下城区(330103)已撤并入上城区, 江干区(330104)已撤并入上城区+拱墅区
// 新增临平区(330113), 钱塘区(330114)
const HANGZHOU_DISTRICTS = {
  "330102": "上城区",
  "330105": "拱墅区",
  "330106": "西湖区",
  "330108": "滨江区",
  "330109": "萧山区",
  "330110": "余杭区",
  "330111": "富阳区",
  "330112": "临安区",
  "330113": "临平区",
  "330114": "钱塘区",
  "330122": "桐庐县",
  "330127": "淳安县",
  "330182": "建德市"
};

// 杭州市 镇/街 级数据
const HANGZHOU_TOWNS = {
  "330102": [ // 上城区
    "清波街道","湖滨街道","小营街道","南星街道","紫阳街道","望江街道",
    "采荷街道","凯旋街道","四季青街道","闸弄口街道","彭埠街道","笕桥街道","丁兰街道","九堡街道"
  ],
  "330105": [ // 拱墅区
    "米市巷街道","湖墅街道","小河街道","和睦街道","拱宸桥街道","大关街道",
    "上塘街道","半山街道","康桥街道","祥符街道","长庆街道","武林街道",
    "天水街道","朝晖街道","文晖街道","东新街道","石桥街道","潮鸣街道"
  ],
  "330106": [ // 西湖区
    "北山街道","西溪街道","翠苑街道","古荡街道","文新街道","蒋村街道",
    "灵隐街道","留下街道","转塘街道","三墩镇","双浦镇"
  ],
  "330108": [ // 滨江区
    "西兴街道","长河街道","浦沿街道"
  ],
  "330109": [ // 萧山区
    "城厢街道","北干街道","蜀山街道","新塘街道","盈丰街道","宁围街道",
    "新街街道","闻堰街道","南阳街道","靖江街道","义蓬街道","河庄街道",
    "新湾街道","临江街道","前进街道","瓜沥镇","临浦镇","义桥镇",
    "所前镇","衙前镇","浦阳镇","进化镇","戴村镇","河上镇","楼塔镇","益农镇","党湾镇"
  ],
  "330110": [ // 余杭区
    "余杭街道","闲林街道","仓前街道","中泰街道","五常街道","良渚街道",
    "仁和街道","瓶窑镇","径山镇","黄湖镇","鸬鸟镇","百丈镇"
  ],
  "330111": [ // 富阳区
    "富春街道","春江街道","东洲街道","鹿山街道","银湖街道","大源镇",
    "灵桥镇","里山镇","渔山乡","常绿镇","湖源乡","万市镇","洞桥镇",
    "新登镇","渌渚镇","胥口镇","永昌镇","常安镇","龙门镇","上官乡","环山乡"
  ],
  "330112": [ // 临安区
    "锦城街道","锦北街道","锦南街道","玲珑街道","青山湖街道","板桥镇",
    "高虹镇","太湖源镇","於潜镇","天目山镇","太阳镇","潜川镇","昌化镇",
    "龙岗镇","河桥镇","湍口镇","清凉峰镇","岛石镇"
  ],
  "330113": [ // 临平区
    "临平街道","东湖街道","南苑街道","星桥街道","乔司街道","运河街道",
    "崇贤街道","塘栖镇","临平经济技术开发区"
  ],
  "330114": [ // 钱塘区
    "下沙街道","白杨街道","河庄街道","义蓬街道","新湾街道","临江街道","前进街道"
  ],
  "330122": [ // 桐庐县
    "桐君街道","城南街道","凤川街道","富春江镇","横村镇","分水镇",
    "瑶琳镇","百江镇","江南镇","新合乡","莪山畲族乡","钟山乡","合村乡"
  ],
  "330127": [ // 淳安县
    "千岛湖镇","文昌镇","石林镇","姜家镇","梓桐镇","汾口镇","大墅镇",
    "威坪镇","临岐镇","枫树岭镇","中洲镇","浪川乡","鸠坑乡","宋村乡",
    "金峰乡","里商乡","安阳乡","瑶山乡","屏门乡","王阜乡","左口乡","富文乡"
  ],
  "330182": [ // 建德市
    "新安江街道","洋溪街道","更楼街道","梅城镇","寿昌镇","大同镇",
    "乾潭镇","三都镇","杨村桥镇","下涯镇","大慈岩镇","航头镇","李家镇",
    "大洋镇","莲花镇","钦堂乡"
  ]
};

for (const [pCode, pName] of Object.entries(provinces)) {
  const province = { value: pCode, label: pName, children: [] };
  const cities = m[pCode];
  if (!cities) { tree.push(province); continue; }

  const isMunicipality = MUNICIPALITY_CODES.includes(pCode);

  for (const [cCode, cName] of Object.entries(cities)) {
    if (isMunicipality) {
      const districts = m[cCode];
      if (districts) {
        for (const [dCode, dName] of Object.entries(districts)) {
          province.children.push({ value: dCode, label: dName, isLeaf: true });
        }
      }
      continue;
    }

    const city = { value: cCode, label: cName, isLeaf: false, children: [] };

    // 杭州市：使用最新区划 + 镇街级数据
    if (cCode === "330100") {
      for (const [dCode, dName] of Object.entries(HANGZHOU_DISTRICTS)) {
        const district = { value: dCode, label: dName, isLeaf: false, children: [] };
        const towns = HANGZHOU_TOWNS[dCode];
        if (towns) {
          for (const town of towns) {
            district.children.push({ value: dCode + "_" + town, label: town, isLeaf: true });
          }
        }
        city.children.push(district);
      }
    }

    if (city.children.length === 0) {
      delete city.children;
      city.isLeaf = true;
    }
    province.children.push(city);
  }
  tree.push(province);
}

const out = `// Auto-generated. 杭州市区划已更新为最新数据（2024），含镇/街级。
// Province → city → district → town/street tree for antd Cascader.

export type DivisionNode = {
  value: string;
  label: string;
  isLeaf?: boolean;
  children?: DivisionNode[];
};

export const DIVISIONS: DivisionNode[] = ${JSON.stringify(tree, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, "..", "..", "lib", "china-divisions.ts"), out, "utf8");
console.log("Generated lib/china-divisions.ts");
console.log("Provinces:", tree.length);
console.log("Hangzhou districts:", Object.keys(HANGZHOU_DISTRICTS).length);
console.log("Hangzhou towns total:", Object.values(HANGZHOU_TOWNS).reduce((a, t) => a + t.length, 0));
console.log("File size:", (fs.statSync(path.join(__dirname, "..", "..", "lib", "china-divisions.ts")).size / 1024).toFixed(1), "KB");
