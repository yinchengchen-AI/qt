# 旧 FineUI MySQL → qt-biz 迁移归档

**迁移日期**: 2026-06-15
**旧库**: `mysql-fineui` (MySQL 8.0.46, 库 fineuicorecontext, 端口 3307)
**新库**: `qt_biz` (PostgreSQL 16 + Prisma 7)

## 备份文件

| 文件 | 大小 | 说明 |
|---|---:|---|
| `fineuicorecontext_20260615_153750.sql` | 5.3 MB | mysqldump 整库 |
| `csv/companies.csv` | 166 KB | 2091 公司 |
| `csv/services.csv` | 1.3 MB | 4656 合同/服务 |
| `csv/invoices.csv` | 345 KB | 4926 开票 |
| `csv/collections.csv` | 262 KB | 5171 回款 |
| `csv/users.csv` | 5.8 KB | 52 用户 |
| `csv/depts.csv` | 124 B | 3 部门 |
| `csv/areas.csv` | 880 B | 26 区域 |
| `csv/serviceprojects.csv` | 929 B | 22 服务项目类型 |
| `csv/servicerecords.csv` | 21 KB | 473 服务记录 |
| `mysql-fineui-inspect.json` | 9 KB | 容器元数据 |

## 迁移结果

| 阶段 | 写入 | 备注 |
|---|---:|---|
| A0 Dictionary(SERVICE_TYPE) | 22 | LEGACY-{ID} / LEGACY-{父}.{ID} |
| A Dictionary(REGION) | 26 | R{ID} / R{父}.{ID} |
| B Department | 3 | 旧研发/开发/测试，挂在业务部(biz)下 |
| C User | 52 | email=legacy.{ID}@qt.local, 密码=Reset@2026 |
| D Customer | 2091 | 2 重名 → 加 `(LEGACY-{ID})` 后缀 |
| D ContactPerson | 1838 | 253 条 phone 空 → 跳过 |
| E Contract | 4656 | 1375 保留原号 + 31 DUP 后缀 + 3281 生成新号 |
| E Project | 4656 | 1:1 跟合同 |
| F Invoice | 4926 | 559 invoiceNo 重 → 加 DUP 后缀 |
| G Payment | 5170 | 1 条 amount≤0 跳过，3266 自动配 invoiceId |

## 金额对账

| 项 | 旧库 | 新库 | 差异 | 说明 |
|---|---:|---:|---:|---|
| Contracts totalAmount | 54,402,343.66 | 54,402,345.12 | +1.46 | 146 份 0 元合同修复为 0.01 |
| Invoices amount | 46,883,206.98 | 46,883,206.98 | 0.00 | 完全一致 |
| Payments amount | (未对账) | 44,519,220.98 | – | 旧 1 笔过滤 |

## 报告

- `reports/migrate-report.json` — 阶段耗时 / 行数 / 错误
- `reports/verify-report.json` — 验证结果
- `reports/run.log` / `dry-run.log` / `verify.log` — 执行日志

## 保留策略

- 备份至少保留 90 天
- mysql-fineui 容器保留 30 天只读，90 天后 `docker rm`
