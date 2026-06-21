-- AlterTable
-- 客户所在地 4 级: province (省) → city (市) → district (区) → town (镇/街).
-- 老数据只到 2 级 (province/city) + 镇/街塞到 town, 区级在 address 字符串里, 显示成 "xx区xx街道".
-- 这次只加 nullable 列, 不动老数据; 数据清理见 scripts/migrate/customer-district-backfill.mjs.
ALTER TABLE "Customer" ADD COLUMN "district" TEXT;
