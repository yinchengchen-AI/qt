# 鏉窞浼佹嘲瀹夊叏绉戞妧 涓氬姟绠＄悊绯荤粺 (qt-biz)

> 瀹㈡埛 / 鍚堝悓 / 寮€绁?/ 鍥炴 涓€浣撳寲绠＄悊,闄勪欢璧?MinIO presigned 鐩翠紶銆?
> **褰撳墠鐗堟湰: v0.8.1**(2026-07-04)
> 璇︾粏璁捐瑙?[docs/DESIGN-v3.md](docs/DESIGN-v3.md),鐢ㄦ埛鎵嬪唽瑙?[docs/USER_MANUAL.md](docs/USER_MANUAL.md)銆?
> 2026-07-04 澧為噺鍚屾: 鍏ㄥ簱浠ｇ爜瀹¤ 10 澶?bug 淇 + 2 缁勫崟鍏冩祴璇曞凡琛ュ埌銆屾渶杩戞洿鏂般€嶅紑澶淬€?

## 鐩綍

- [鎶€鏈爤](#鎶€鏈爤)
- [蹇€熷惎鍔╙(#蹇€熷惎鍔?
- [椤圭洰缁撴瀯](#椤圭洰缁撴瀯)
- [涓氬姟妯″潡](#涓氬姟妯″潡)
- [鏁版嵁妯″瀷涓庣姸鎬佹満](#鏁版嵁妯″瀷涓庣姸鎬佹満)
- [璺ㄦā鍧楁牎楠岃鍒橾(#璺ㄦā鍧楁牎楠岃鍒?
- [璁よ瘉 & 鏉冮檺](#璁よ瘉--鏉冮檺)
- [闄勪欢瀛樺偍 (MinIO)](#闄勪欢瀛樺偍-minio)
- [娑堟伅涓庨€氱煡](#娑堟伅涓庨€氱煡)
- [瀹氭椂浠诲姟](#瀹氭椂浠诲姟)
- [缁熻鍒嗘瀽](#缁熻鍒嗘瀽)
- [绉诲姩绔€傞厤](#绉诲姩绔€傞厤)
- [鑴氭湰閫熸煡](#鑴氭湰閫熸煡)
- [璐ㄩ噺鍩虹嚎](#璐ㄩ噺鍩虹嚎)
- [鏈€杩戞洿鏂癩(#鏈€杩戞洿鏂?
- [鍘嗗彶閲岀▼纰慮(#鍘嗗彶閲岀▼纰?
- [閮ㄧ讲](#閮ㄧ讲)
- [鐩稿叧鏂囨。](#鐩稿叧鏂囨。)

## 鎶€鏈爤

| 灞?| 閫夊瀷 | 鐗堟湰 |
|---|---|---|
| 妗嗘灦 | Next.js (App Router + RSC + Server Actions) | 16.2.7 |
| 杩愯鏃?| React | 19.2.7 |
| 璇█ | TypeScript (`strict` + `noUncheckedIndexedAccess`) | 6.0.3 |
| UI | Ant Design + @ant-design/pro-components (beta) | 6.4.3 / 3.1.12-0 |
| 鍥捐〃 | @ant-design/charts | 2.6.7 |
| 鐘舵€?| zustand | 5.0.14 |
| 鏁版嵁璇锋眰 | swr | 2.4.1 |
| 鏍￠獙 | zod | 4.4.3 |
| ORM | Prisma + @prisma/adapter-pg | 7.8.0 |
| 鏁版嵁搴?| PostgreSQL | 16 |
| 瀵硅薄瀛樺偍 | MinIO + @aws-sdk/client-s3 v3 | latest |
| 璁よ瘉 | NextAuth (Credentials + JWT) | 4.24.14 |
| 鍔犲瘑 | bcrypt | 6.0.0 |
| 娴嬭瘯 | Vitest + @playwright/test | 4.1.8 / 1.60.0 |

瀹屾暣鐗堟湰鐭╅樀涓庡吋瀹规€ц鏄庤 [docs/DESIGN-v3.md 搂1](docs/DESIGN-v3.md)銆?

## 蹇€熷惎鍔?

闇€瑕?Node `>=20.9.0`,Docker(鏈湴璧?Postgres + MinIO)銆?

```bash
# 涓€閿叏娴佺▼:璧?PG + MinIO + 瑁呬緷璧?+ 鎺ㄥ簱 + seed + 璧?dev server
# (榛樿杩樹細 seed 4 涓?dev 娴嬭瘯璐﹀彿 + 100 涓?dev 瀹㈡埛;鍓嶅彴杩涚▼,Ctrl-C 閫€鍑?
npm run dev:setup
```

濡傞渶鎵嬪姩鍒嗘(鐢熶骇閮ㄧ讲 / 鑷畾涔?seed):

```bash
# 1) 璧峰熀纭€璁炬柦
docker compose -f docker-compose.postgres.yml up -d
docker compose -f docker-compose.minio.yml up -d

# 2) 閰嶇幆澧冨彉閲?
cp .env.example .env   # 榛樿 minioadmin/minioadmin, qitai/qitai_pass

# 3) 瑁呬緷璧?+ 鎺ㄥ簱
npm install
npx prisma migrate dev

# 4) 绯荤粺绠＄悊鏁版嵁
npm run seed           # 5 瑙掕壊 / 5 閮ㄩ棬 / 8 绫诲瓧鍏?
npm run seed:dev-users # 鍙€? 4 涓?dev 娴嬭瘯璐﹀彿

# 5) 鍒涘缓绗竴涓笟鍔＄鐞嗗憳
npm run create-admin -- \
  --employeeNo admin \
  --name "绯荤粺绠＄悊鍛? \
  --email admin@example.com \
  --password 'Your-Strong-Pwd-2026'

# 6) 璧锋湇鍔?
npm run dev            # http://localhost:3000
```

### 娴嬭瘯璐﹀彿(dev 蹇€熷～鍏呭崱)

鐧诲綍椤靛彸涓嬭"娴嬭瘯璐﹀彿"鍗″垪鍑?4 涓鑹茶处鍙?`seed:dev-users` 杩樹細寤?`expert` 鍏?5 涓?瀵嗙爜缁熶竴浠?`DEV_QUICK_FILL_PASSWORD`(榛樿 `dev-only-fill`)璇?鍙緵 dev/test 鐢ㄣ€?

```bash
npm run seed:dev-users
```

## 椤圭洰缁撴瀯

```
app/                       Next.js App Router(椤甸潰 + Route Handlers)
  (app)/                   宸茬櫥褰曞竷灞€ (Sider + Header + Content)
    dashboard/             宸ヤ綔鍙?
    customers/             瀹㈡埛绠＄悊
    contracts/             鍚堝悓绠＄悊
    invoices/              寮€绁ㄧ鐞?
    payments/              鍥炴绠＄悊
    statistics/            缁熻鍒嗘瀽(鎬昏/璐﹂緞/涓氱哗/Top)
    admin/                 绯荤粺绠＄悊(鐢ㄦ埛/瑙掕壊/閮ㄩ棬/瀛楀吀/瀹¤)
    messages/              娑堟伅涓績
    announcements/         鍏憡
  api/                     Route Handlers(瑙佷笅)
  login/                   鐧诲綍椤?
components/                鍏变韩 UI(admin/customers/file/form/...)
lib/                       瀹㈡埛绔€昏緫(auth/permissions/validators/i18n/...)
server/                    鍚庣鏈嶅姟灞?services/events/jobs/storage/audit)
prisma/                    schema.prisma + seed + migrations/
tests/                     Vitest(unit + api) + Playwright(e2e)
docs/                      璁捐 / 璇勫 / 鎵嬪唽 / 閮ㄧ讲
ops/                       杩愮淮鑴氭湰
scripts/                   dev/prod/migrate/shared CLI
docker-compose.postgres.yml
docker-compose.minio.yml
```

### 璺敱涓€瑙?

- `app/api/auth/` 鈥?NextAuth
- `app/api/{customers,contracts,invoices,payments}/` 鈥?鍥涘ぇ涓氬姟 CRUD
- `app/api/files/` 鈥?闄勪欢 presigned URL
- `app/api/messages/` 鈥?绔欏唴淇?
- `app/api/announcements/` 鈥?鍏憡
- `app/api/dashboard/` 鈥?宸ヤ綔鍙版眹鎬?
- `app/api/statistics/` 鈥?缁熻鍒嗘瀽
- `app/api/{users,roles,departments,dictionaries,admin}/` 鈥?绯荤粺绠＄悊
  - 鍛樺伐妗ｆ(v0.4+)璧?5 姝ュ悜瀵?+ 5 寮犲瓙琛?鏁欒偛/宸ヤ綔/璇佷功/鎶€鑳?绱ф€ヨ仈绯讳汉);璇佷功 30/15/7 澶╁埌鏈?cron 鎻愰啋;璇︽儏椤?Anchor 婊氬姩
- `app/api/operation-logs/` 鈥?鎿嶄綔鏃ュ織
- `app/api/jobs/` 鈥?瀹氭椂浠诲姟瑙﹀彂绔偣

## 涓氬姟妯″潡

### 鍥涘ぇ鏍稿績涓氬姟妯″潡

| 妯″潡 | 璇存槑 | 鐘舵€佹満 | 鍏抽敭鏂囦欢 |
|---|---|---|---|
| 瀹㈡埛 (Customer) | 瀹㈡埛妗ｆ銆佽仈绯讳汉銆佽窡杩涜褰?鏀寔缁熶竴绀句細淇＄敤浠ｇ爜鏍￠獙 | 鏃?瀹㈡埛鐘舵€佹満 v0.5.0 宸蹭笅绾? | `server/services/customer/{crud,overview,index}.ts` |
| 鍚堝悓 (Contract) | 鍚堝悓璧疯崏銆佸鎵广€佺璁€佸饱绾︺€佸綊妗?鍚?reopen / force 鏃佽矾鐢ㄤ簬鍘嗗彶鏁版嵁淇 | DRAFT / ACTIVE / CLOSED (3 鎬?+ 鑷姩杞崲) | `server/services/contract/{crud,status,jobs,reopen,overview,index}.ts` |
| 寮€绁?(Invoice) | 鍙戠エ鐢宠銆佽储鍔″鏍搞€佸紑鍏枫€佷綔搴熴€佺孩鍐?| DRAFT / PENDING_FINANCE / ISSUED / VOIDED / RED_FLUSHED | `server/services/invoice/{crud,action,index}.ts` |
| 鍥炴 (Payment) | 鍥炴璁″垝鐧昏銆佺‘璁ゃ€佸璐︺€侀€€娆?| PLANNED / CONFIRMED / RECONCILED / REFUNDED / CANCELLED | `server/services/payment.ts` |

### 澧炲€间笟鍔℃ā鍧?

| 妯″潡 | 璇存槑 | 鍏抽敭鏂囦欢 |
|---|---|---|
| 搴旀敹璐﹂緞 & 鍌敹 (Aging / Dunning) | 鎸夊鎴?璐熻矗浜虹淮搴﹀垎 0-30/30-60/60-90/90+ 璐﹂緞妗?鏀寔鍌敹璁板綍 CRUD 涓庡埌鏈熸彁閱?| `server/services/statistics.ts`銆乣server/services/dunning.ts` |
| 鍛樺伐妗ｆ (Employee Profile) | 5 姝ュ悜瀵?+ 5 寮犲瓙琛?鏁欒偛/宸ヤ綔/璇佷功/鎶€鑳?绱ф€ヨ仈绯讳汉);璇佷功 30/15/7 澶╁埌鏈?cron 鎻愰啋 | `server/services/employee-profile.ts`銆乣server/services/employee-*.ts` |

### 鏀拺妯″潡

- **绯荤粺绠＄悊** 鈥?鐢ㄦ埛/瑙掕壊/閮ㄩ棬/瀛楀吀/瀹¤鏃ュ織/鍥炴敹绔?瑙?`app/(app)/admin/` 涓?`server/services/{user,role,department,dictionary,trash}.ts`
- **娑堟伅涓績** 鈥?`server/services/message.ts` + `server/events/bus.ts`,棰嗗煙浜嬩欢鈫掔珯鍐呬俊
- **鍏憡** 鈥?`server/services/announcement.ts`
- **缁熻鍒嗘瀽** 鈥?宸ヤ綔鍙?鎬昏/鍖哄煙/涓氱哗/Top 瀹㈡埛/xlsx 瀵煎嚭,瑙?`server/services/statistics.ts`
- **鎿嶄綔鏃ュ織** 鈥?`server/audit.ts` + `lib/request-context.ts` 鑷姩娉ㄥ叆 IP/UA/requestId
- **瀹氭椂浠诲姟** 鈥?6 涓?job锛坈ontract-expiring / invoice-overdue / contract-auto-publish / contract-auto-complete / contract-stale-notify / certificate-expiry-check锛夌粺涓€璧?`/api/jobs/run-all`;鐢熶骇寤鸿 Vercel Cron 姣忓皬鏃惰Е鍙?
- **杞垹闄?& 鍥炴敹绔?* 鈥?`deletedAt` + 30s TTL 缂撳瓨,缁熶竴璧?`server/services/trash.ts`

## 鏁版嵁妯″瀷涓庣姸鎬佹満

Prisma schema 瑙?[prisma/schema.prisma](prisma/schema.prisma),瀹屾暣鐘舵€佹満杩佺Щ涓庤縼绉?SQL 瑙?`prisma/migrations/`銆?

### Contract 鐘舵€佹満(7 鈫?3 鏀舵暃)

```
DRAFT 鈹€鈹€(瀛楁瀹屾暣 + 闄勪欢)鈹€鈹€> ACTIVE 鈹€鈹€(寮€绁ㄨ冻棰?R-07)鈹€鈹€> CLOSED
                                  鈹斺攢(endDate < now)鈹€鈹€鈹€鈹€> CLOSED (reason=expired)
```

鑷姩杞崲:`tryAutoPublish`(DRAFT 鈫?ACTIVE) / `tryAutoComplete`(ACTIVE 鈫?CLOSED,寮€绁ㄨ冻棰? / `tryAutoExpire`(endDate 鍒版湡)銆俛ctor 缁熶竴涓?`system` 鍗犱綅鐢ㄦ埛(`User.isSystem=true`,涓嶅彲鐧诲綍)銆?

### Invoice 鐘舵€佹満(6 鎬?

```
DRAFT 鈹€鈹€submit鈹€鈹€> PENDING_FINANCE 鈹€鈹€issue鈹€鈹€> ISSUED
                                              鈹溾攢> VOIDED (浣滃簾)
                                              鈹斺攢> RED_FLUSHED (绾㈠啿)
```

### Payment 鐘舵€佹満(5 鎬?

```
PLANNED 鈹€鈹€confirm鈹€鈹€> CONFIRMED 鈹€鈹€reconcile鈹€鈹€> RECONCILED
                  鈹溾攢> REFUNDED (閫€娆?
                  鈹斺攢> CANCELLED (鍙栨秷)
```


## 璺ㄦā鍧楁牎楠岃鍒?

| 瑙勫垯 | 鍚箟 | 鏍￠獙鐐?| 閿欒鐮?|
|---|---|---|---|
| R-01 | 瀹㈡埛缁熶竴绀句細淇＄敤浠ｇ爜 GB 32100-2015 | Zod refine | 400 |
| R-07 | 鍚堝悓 ACTIVE 鈫?CLOSED 闇€寮€绁ㄨ冻棰?| service 浜嬪姟 | 鈥?|
| R-08 | 绱寮€绁?鈮?鍚堝悓鎬婚 | service 浜嬪姟 | 422 INVOICE_OVER_LIMIT |
| R-09 | 鍙戠エ ISSUED 闇€鎶ご + 绋庡彿 | service 浜嬪姟 | 422 INVOICE_INFO_INVALID |
| R-10 | 鍥炴 bankRefNo CONFIRMED 鍞竴 | service 浜嬪姟 | 409 PAYMENT_DUPLICATE_REF |
| R-11 | 鍙戠エ绾у洖娆句笉瓒呴 | service 浜嬪姟 | 422 PAYMENT_OVER_INVOICE |
| R-12 | 鍚堝悓绾у洖娆句笉瓒呴 | service 浜嬪姟 | 422 PAYMENT_OVER_CONTRACT |
| 鈥?| SALES 琛岀骇闅旂 | ownershipWhere 娉ㄥ叆 | 404 |

瀹屾暣瑙勫垯涓庤竟鐣屽満鏅 [docs/DESIGN-v3.md 搂6](docs/DESIGN-v3.md)銆?

## 璁よ瘉 & 鏉冮檺

NextAuth v4 + JWT 绛栫暐(涓嶆寕 PrismaAdapter,P0 闃舵绠€鍖?銆?

### 銆? 澶╁唴鑷姩鐧诲綍銆?

- 鐧诲綍椤靛嬀閫夊閫夋 鈫?JWT 瀵垮懡 7 澶?涓嶅嬀閫?鈫?8 灏忔椂
- 瀹炵幇:`lib/auth.ts` 鑷畾涔?`authOptions.jwt.encode` 鎷︽埅 `maxAge`
- e2e 楠岃瘉:`tests/e2e/auto-login.spec.ts` 鐢?`jose.jwtDecrypt` + 32 瀛楄妭 HKDF 瑙ｅ瘑 JWE 鏂█ `exp - iat`

### 5 瑙掕壊 RBAC

| 瑙掕壊 | 鐢ㄩ€?| 鏉冮檺浣?|
|---|---|---|
| ADMIN | 鍏ㄩ儴鎿嶄綔 + 绯荤粺绠＄悊 | 鍏ㄩ噺 |
| SALES | 涓氬姟鎵ц,琛岀骇闅旂 | 涓氬姟妯″潡 R/W,鍙鑷繁 owner 鐨勬暟鎹?|
| FINANCE | 寮€绁?鍥炴 | 寮€绁?鍥炴 R/W,鍏朵綑鍙 |
| OPS | 閮ㄩ棬/瀛楀吀缁存姢 | 绯荤粺绠＄悊 R/W,涓氬姟鍙 |
| EXPERT | 涓撳瑙掕壊(鏉冮檺娴嬭瘯) | 鏈€灏忔潈闄?|

鏉冮檺浣嶅畾涔夊湪 `lib/permissions.ts`,涓?`prisma/seed.ts` 鍚屾簮銆係ALES 琛岀骇闅旂渚濋潬 `ownershipWhere(user)` 娉ㄥ叆 Prisma 鏌ヨ `where` 瀛愬彞銆?

### Cookie & 浼氳瘽

- 鐢熶骇 `useSecureCookies` 浠呭湪 `FORCE_HTTPS=true` 鏃跺紑鍚?HTTP 鍙嶄唬涓嬩繚鎸侀潪 secure)
- 瀵嗙爜 bcrypt cost=10 鍝堝笇
- 瑙掕壊 / 鐘舵€?30s TTL 缂撳瓨,admin 鏀硅鑹?/ 绂佺敤鎴锋渶杩?30s 鐢熸晥

## 闄勪欢瀛樺偍 (MinIO)

闄勪欢涓婁紶璧?presigned PUT 鐩翠紶,涓嶇粡杩囧簲鐢ㄦ湇鍔″櫒銆?

**鍚姩**

```bash
docker compose -f docker-compose.minio.yml up -d
# Console: http://localhost:9001  璐﹀彿 minioadmin / minioadmin
# S3 API:  http://localhost:9000
```

`qitai-minio-init` 瀹瑰櫒鍦ㄤ富鏈嶅姟 healthy 鍚庤嚜鍔ㄥ缓妗?`qt-biz-attachments`(绉佹湁)銆?

**鍏抽敭娴佺▼**

1. 鍓嶇 `ProFormUploadButton` 鐨?`customRequest` 璋?`POST /api/files/presign-upload` 鎷?5min 鏈夋晥 PUT URL
2. 娴忚鍣?`fetch(url, { method: "PUT", body: file })` 鐩翠紶 MinIO
3. 璇︽儏椤电偣鏂囦欢鍚?鈫?`POST /api/files/[id]/presign-download` 鎷?5min GET URL 鈫?鏂版爣绛炬墦寮€

**涓氬姟瑙勫垯**

- MIME 鐧藉悕鍗?PDF / Word / Excel / JPEG / PNG / WebP
- 鍗曟枃浠?鈮?20MB,鍗曞悎鍚岄檮浠?鈮?5
- `objectKey` 鍛藉悕:`contracts/{yyyy}/{mm}/{cuid}-{slug}.{ext}`
- 涓嬭浇閴存潈:澶嶇敤 `requireSession()` + 鍚堝悓 `read` 鏉冮檺
- 杞垹闄?鍒?`Attachment` 璁板綍浣嗕繚鐣?MinIO 瀵硅薄

**鍏抽敭鏂囦欢**

| 鏂囦欢 | 鑱岃矗 |
|---|---|
| `server/storage/minio.ts` | S3Client 鍗曚緥 + ensureBucket + CORS |
| `server/storage/presign.ts` | `presignUpload` / `presignDownload` |
| `app/api/files/presign-upload/route.ts` | 鎷?PUT URL |
| `app/api/files/[id]/presign-download/route.ts` | 鎷?GET URL |
| `app/api/files/[id]/route.ts` | 杞垹闄?|
| `lib/upload-client.ts` | 娴忚鍣?`customRequest` 涓婁紶灏佽 |

## 娑堟伅涓庨€氱煡

閫氱煡缁熶竴璧扮珯鍐呬俊锛堥《鏍忛搩閾?+ `/messages`锛夈€傞偖浠?/ 浼佷笟寰俊閫氶亾宸蹭笅绾匡紝杩愮淮渚т笉鍐嶉渶瑕?SMTP 鎴?webhook 鍑嵁銆?

**棰嗗煙浜嬩欢瑙﹀彂鐭╅樀**(`server/events/bus.ts`)

| 浜嬩欢 | 瑙﹀彂鏃舵満 | 鎺ユ敹浜?|
|---|---|---|
| CONTRACT_PENDING_REVIEW | 鍚堝悓 submit | 鍏ㄩ儴 ADMIN |
| CONTRACT_APPROVED | 鍚堝悓 approve | contract.ownerUserId |
| CONTRACT_REJECTED | 鍚堝悓 reject | contract.ownerUserId |
| PAYMENT_RECEIVED | 鍥炴 confirm | owner + 鍏ㄩ儴 ADMIN |
| INVOICE_OVERDUE_PAYMENT | 瀹氭椂浠诲姟(issue + 30 澶? | owner + admin + finance |
| CONTRACT_EXPIRING | 瀹氭椂浠诲姟(endDate - 30/7/1) | owner + admin |
| CONTRACT_AUTO_EXECUTED | 椤圭洰 start 瑙﹀彂 | owner + 鍏ㄩ儴 ADMIN |
| CONTRACT_AUTO_COMPLETED | 鍚堝悓涓嬫墍鏈夐」鐩敹灏?| owner + 鍏ㄩ儴 ADMIN |
| CONTRACT_AUTO_EXPIRED | 瀹氭椂浠诲姟(endDate < now) | owner + 鍏ㄩ儴 ADMIN |

## 瀹氭椂浠诲姟

6 涓?job锛坈ontract-expiring / invoice-overdue / contract-auto-publish / contract-auto-complete / contract-stale-notify / certificate-expiry-check锛夌粺涓€閫氳繃 `/api/jobs/run-all` 瑙﹀彂銆?

```bash
# 绠＄悊鍛樻墜鍔ㄨЕ鍙?鐢熶骇鐜闇€ Authorization: Bearer $CRON_SECRET)
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/run-all

# 鍗曡窇
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiring
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/invoice-overdue
curl -X POST -b cookie.txt http://localhost:3000/api/jobs/contract-expiry
```

鐢熶骇寤鸿 Vercel Cron 姣忓皬鏃惰Е鍙戜竴娆?`/api/jobs/run-all`:

```json
{
  "crons": [{ "path": "/api/jobs/run-all", "schedule": "0 * * * *" }]
}
```

`runAllJobs` 棰勫彇 admin 鍒楄〃涓€娆?鎵€鏈?job 澶嶇敤(N+1 鈫?1)銆傜敓浜х幆澧冨己鍒?`CRON_SECRET`,缂哄け鏃?500 鍛婅骞舵嫆缁濇墽琛屻€?

## 缁熻鍒嗘瀽

```bash
GET /api/dashboard/summary                          # 宸ヤ綔鍙?4 鍗＄墖 + 璐﹂緞
GET /api/statistics/overview?from&to                # 鎬昏 + 鏃堕棿搴忓垪
GET /api/statistics/invoice-aging                   # 搴旀敹璐︽璐﹂緞
GET /api/statistics/top-customers?metric=contract|payment&limit=10
GET /api/statistics/employee-performance?userId=&from=&to=
GET /api/statistics/export?type=overview|top-customers|employee-performance   # xlsx 涓嬭浇
```

xlsx 瀵煎嚭璧?`lib/excel.ts` + `exceljs`; 涓枃鏂囦欢鍚嶉€氳繃 `attachmentHeader()` 璧?RFC 5987 鍙屽舰寮?`filename=` ASCII 鍏滃簳 + `filename*=UTF-8''...`)銆?

## 绉诲姩绔€傞厤

鏂偣娌跨敤 Antd 6 榛樿(`xs=480` / `sm=576` / `md=768` / `lg=992` / `xl=1200`),`md` 浣滀负鎵嬫満/骞虫澘鍒嗘按宀€?

**Shell 琛屼负**

- `>=md` 妗岄潰:宸?232px 鍥哄畾 Sider + 椤堕儴 64px Header
- `<md` 鎵嬫満:Sider 鏀惰捣,椤舵爮宸︿晶姹夊牎鎸夐挳 鈫?宸︽娊灞?Drawer(`min(320, 85vw)`),甯﹂伄缃?璺敱鍒囨崲 / 鑿滃崟鐐瑰嚮 / 閬僵鐐瑰嚮鑷姩鍏抽棴
- 澶村儚 + 鐢ㄦ埛鍚?+ 瑙掕壊鍦?`<sm` 鏋佺獎灞忛殣钘?鍙繚鐣欏ご鍍?
- 闈㈠寘灞戝湪 `<sm` 鍙樉绀烘渶鍚庝竴娈?

**涓氬姟椤佃涓?*

- 鍒楄〃:ProTable 鍔?`scroll.x: max-content` + sticky 澶?绉诲姩绔悳绱㈡爮 `layout: vertical`銆佸垎椤?`size: small`;棣栧垪 `fixed: left` 渚夸簬妯粦
- 璇︽儏:ProDescriptions 鏀逛负 `{ xs:1, sm:1, md:2, lg:2, xl:3 }` 鍒楁暟;鍐呭祵 ProTable 鍚屾牱鍔?`scroll.x` + sticky
- 琛ㄥ崟:FormGrid 鍦?`<sm` 寮哄埗 1 鍒?SubmitBar 绉诲姩绔潡鐘舵寜閽?+ 璐村簳瀹夊叏鍖?
- 鎶藉眽:`<md` 鏀?`placement: bottom`銆乣width: 100%`銆乣height: 90%`
- 缁熻:鍥捐〃 `autoFit` + 楂樺害鍦?`<md` 鍘嬬缉鍒?240px

**瑙︽懜涓庡彲杈炬€?*

- 閲嶈鎸夐挳(`size="large"`)鍦?`<md` 寮哄埗 鈮?40px 鍛戒腑鍖?
- 涓讳綋鍔?`.qt-touch` class,绂佺敤鑿滃崟 hover-to-open
- `:focus-visible` 娌跨敤 Antd 涓昏壊閿洏鐒︾偣鐜?
- 绉婚櫎 `-webkit-tap-highlight-color`,鐢?Antd 鑷甫 active 鎬?

**瀹炵幇瑕佺偣**

- 鍗曚竴 hook `lib/use-breakpoint.ts`:钖勫寘瑁?`antd.Grid.useBreakpoint()`,SSR 瀹夊叏(棣栨娓叉煋淇濆畧杩斿洖妗岄潰)
- 涓嶅紩鍏?Tailwind / 棰濆 UI 搴?`globals.css` 鏂板 `.pt-safe` / `.pb-safe` 绛夊畨鍏ㄥ尯宸ュ叿绫?
- 妗岄潰绔浂鍥炲綊;鎵嬫満绔垪琛ㄤ粛鏄按骞虫粴鍔ㄨ€岄潪鍗＄墖娴?ProTable 3.1.12-0 beta 鐨?card 瑙嗗浘 API 鏆備笉绋冲畾)

## 鑴氭湰閫熸煡

| 鍛戒护 | 鐢ㄩ€?|
|---|---|
| `npm run dev` | 寮€鍙戞湇鍔″櫒 |
| `npm run dev:setup` | 涓€閿捣 Postgres + MinIO + 瑁呬緷璧?|
| `npm run dev:up` / `dev:down` | 鍚屼笂,浠?Docker 鐢熷懡鍛ㄦ湡 |
| `npm run build` | 鐢熶骇鏋勫缓 |
| `npm run start` | 鍚姩鐢熶骇鏈嶅姟 |
| `npm run typecheck` | TS 绫诲瀷妫€鏌?|
| `npm run lint` / `lint:fix` | ESLint(0 warnings) |
| `npm test` | 鍗曞厓 + API 娴嬭瘯 (Vitest) |
| `npm run test:e2e` | E2E (Playwright) |
| `npm run prisma:migrate` | 鍒涘缓/搴旂敤 migration |
| `npm run prisma:deploy` | 鐢熶骇搴旂敤 migration |
| `npm run prisma:studio` | Prisma Studio |
| `npm run seed` | 璺戠郴缁熺鐞?seed(瑙掕壊/閮ㄩ棬/瀛楀吀/宸ヤ綔娴佹ā鏉? |
| `npm run seed-roles` | 鍙彃 5 瑙掕壊 |
| `npm run seed-dicts` | 鍙彃 8 绫诲瓧鍏?|
| `npm run create-admin` | CLI 鍒涘缓璐﹀彿 |
| `npm run seed:dev-users` | dev 涓撶敤,骞傜瓑 upsert 5 涓祴璇曡处鍙?|
| `npm run reset-password` | 閲嶇疆瀵嗙爜 |
| `npm run loadtest` | 鍘嬫祴 (榛樿 50 骞跺彂 脳 5s) |
| `npm run migrate:legacy[:dry]` | FineUI 鏃у簱杩佺Щ CLI |
| `npm run migrate:contract-status-dict` | 鍚堝悓鐘舵€佹満杩佺Щ(7鈫? 閰嶅瀛楀吀) |
| `npm run migrate:customer-district[:dry]` | 瀹㈡埛鍦板尯瀛楁绂荤嚎琛ュ叏 |

瀹屾暣 scripts 瑙?[package.json](package.json)銆?

## 璐ㄩ噺鍩虹嚎(2026-07-03, v0.8.0)

| 椤?| 鐘舵€?|
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm test` | 65 涓?.test.ts 鏂囦欢 (547 鐢ㄤ緥), 鍏ㄧ豢 (4 涓?pre-existing failures 涓庢湰娆℃敼鍔ㄦ棤鍏? |
| `npm run test:e2e` | 11 specs / 鍏ㄧ豢 |
| `prisma generate` + `migrate deploy` | 28/28 migrations, client v7.8.0 |
| `npm run build` | 鎴愬姛 |

## 鏈€杩戞洿鏂?

### v0.8.1(2026-07-04) 浠ｇ爜瀹¤淇: 鐘舵€佹満骞跺彂瀹夊叏 + 閲戦涓嶅彉寮?+ 瀹㈡埛绔珵鎬侀槻鎶?

> v0.8.0 鎶ヨ〃涓績涓婄嚎鍚?瀵瑰叏椤圭洰鍋氫簡涓€娆′唬鐮佸璁?淇 10 涓珮浼樺厛绾?bug,琛ュ厖 2 缁勫崟鍏冩祴璇曘€傛湰娆¤鐩?11 涓枃浠?0 涓柊杩佺Щ,0 涓?API 濂戠害鍙樻洿銆?

**鐘舵€佹満骞跺彂瀹夊叏 (涓€)** (`lib/status-machine.ts`):
- `runTransitionInTx` 鐨?`UPDATE` 鐜板湪鎶婃簮鐘舵€佸啓杩?`WHERE` (`status: { in: allowedSourceStatuses }`), 闃叉骞跺彂璇?鏀?鍐欒鐩?
- 骞跺彂瀵艰嚧 Prisma `P2025` (鏃犺鍖归厤) 鏃?`silentSkip=true` 杩斿洖 `SKIPPED`,鍚﹀垯鎶涘嚭 `ENTITY_IMMUTABLE` 鎴栬嚜瀹氫箟 `mismatchError`
- 鏂板 `tests/unit/lib/status-machine.test.ts` 8 涓崟娴嬭鐩?WHERE 瀛愬彞 / P2025 鏄犲皠 / 闈?P2025 浼犳挱 / `SkipTransition` 琛屼负

**鍚堝悓閲戦涓嶅彉寮?(浜?** (`server/services/contract/crud.ts`):
- `ADMIN` 璋冨皬 `totalAmount` 鏃?浜嬪姟鍐呰仛鍚堣鍚堝悓涓?`DRAFT/ISSUED/RED_FLUSHED` 鍙戠エ閲戦涓?`CONFIRMED/RECONCILED` 鍥炴閲戦
- 浠讳竴鑱氬悎鍊艰秴杩囨柊鎬婚 + 0.01 鍏冨宸?鎶?`INVOICE_OVER_LIMIT` / `PAYMENT_OVER_CONTRACT` (422)
- 鏂板 `tests/unit/server/contract-update-amount-guard.test.ts` 7 涓崟娴嬭鐩栧厑璁?鎷︽埅/瀹瑰樊杈圭晫

**閲戦绮惧害 (涓?**:
- `server/services/contract/status.ts`: `tryAutoClose` / `tryAutoCloseOnOverdue` 闃堝€艰绠楁敼鐢?`Prisma.Decimal`,閬垮厤 `total * ratio` 娴偣婕傜Щ
- `server/services/invoice/action.ts`: 绾㈠啿鍒涘缓璐熸暟鍙戠エ鏃朵娇鐢?`new Prisma.Decimal(...).negated()` 鏇夸唬 `-Number(...)`;`PLANNED` 鍥炴 `paymentNo` 鏀逛负 `nextBusinessNo("PAYMENT")-PLANNED`,閬垮厤鏃堕棿鎴冲啿绐?

**瀹㈡埛绔珵鎬侀槻鎶?(鍥?**:
- `lib/use-list-request.ts`: 鍔?`requestIdRef` 搴忓彿, 蹇界暐杩囨湡璇锋眰鐨?`setData`
- `app/(app)/dashboard/page.tsx`: `fetch` 鍔?`AbortController`,effect cleanup 涓?abort
- `app/(app)/statistics/aging/page.tsx`: `useMemo` 鍓綔鐢ㄦ敼涓?`useEffect`,`refetchAging` 鍐呭姞璇锋眰搴忓彿/abort 淇濇姢

**鍙傛暟涓?JSON 鏍￠獙 (浜?**:
- `app/api/statistics/export/route.ts`: `minAmount` 杞崲鍚庢鏌?`Number.isNaN`,闈炴硶鏃惰繑鍥?400
- `server/storage/presign.ts`: `contract.attachments` 鍏冪礌鐢?Zod schema 鏍￠獙,寮傚父缁撴瀯鍥為€€绌烘暟缁?

**娴嬭瘯鍔犲浐 (鍏?**:
- 淇 `tests/api/signer-contract-detail.test.ts` SALES 闅旂鏂█,浣垮叾瀵规湰娴嬭瘯 TAG 鍒涘缓鐨勫悎鍚屽仛鏂█,閬垮厤琚?seeded 鏁版嵁姹℃煋
- 鍏ㄩ噺娴嬭瘯: `npm test` 71 鏂囦欢 / 565 娴嬭瘯鍏ㄩ儴閫氳繃

**鐗堟湰鍙?*: `0.8.0` 鈫?`0.8.1`(patch bump,浠?bugfix + 娴嬭瘯,鏃?schema 鍙樻洿,鏃?breaking change)
**閮ㄧ讲璇存槑**: 鏃?schema 鍙樻洿,鏃犳柊杩佺Щ;`prisma migrate deploy` 涓嶉渶瑕佽窇;涓氬姟涓婁粎 `ADMIN` 缂╁皬鍚堝悓鎬婚鏃舵柊澧炴牎楠?姝ｅ父娴佺▼涓嶅彈褰卞搷

### v0.8.0(2026-07-03)鎶ヨ〃涓績閲嶅仛: PDF 5 瀛楁 + 澶?sheet Excel + 鏂囦欢鍚嶆椂闂存埑

> v0.7.0 鎶ヨ〃涓績涓婄嚎鍚? 璺?2026骞?鏈堜笟鍔℃槑缁?pdf 妯℃澘瀵归綈, 鎶婂憳宸ヤ笟缁╁仛鎴愯窡鍘熺増涓€鑷寸殑"鎸夌绾︿汉 + 涓囧厓灏忚"缁撴瀯銆傛湰娆¤鐩?11 涓?commit, 娑夊強 12 涓枃浠? 0 涓柊杩佺Щ (鏁版嵁娌跨敤 v0.7 鐨?ReportDefinition / ReportSnapshot 琛?銆?

**鏍稿績鍙樻洿 (涓€) PDF 5 瀛楁瀵归綈**:
- 鍛樺伐涓氱哗鏄庣粏琛ㄤ弗鏍兼寜鍘?PDF 妯℃澘 5 鍒? 鎵€灞炲尯鍩?/ 浼佷笟鍚嶇О / 鏈嶅姟椤圭洰 / 绛剧害浜?/ 鍚堝悓閲戦(鍏?
- 鏈垪"灏忚(涓囧厓)"鍙湪绛剧害浜哄皬璁¤ + 鍏ㄥ叕鍙稿悎璁¤濉€? 鍚堝悓琛岀┖
- 绛剧害浜哄皬璁¤"绛剧害浜?浣嶇疆鍐?"{濮撳悕} 灏忚", 涓嶅甫宸ュ彿; 鍏ㄥ叕鍙稿悎璁¤鍐?"鍏ㄥ叕鍙稿悎璁?
- 瑙嗚: 绮楅粦杈规 + 娴呴粍/鐏板簳鑹?+ 灞呬腑琛ㄥご + 閲戦鍙冲榻?+ tabular-nums 绛夊鏁板瓧
- 绛剧害鏄庣粏涓嶅啀杈撳嚭: `userId / employeeNo / serviceType 浠ｇ爜 / signDate / contractNo / rowType` (鍐呴儴涓婚敭/鏋氫妇 code, 涓嶅闇?

**Excel 澶?sheet (浜?**:
- `lib/excel.ts` 鏂板 `exportToMultiSheetXlsx` (澶?sheet 瀵煎嚭, 31 瀛楃 sheet 鍚嶆埅鏂? 闈炴硶瀛楃杞?`_`)
- 鎶ヨ〃涓績瀵煎嚭 Excel: 1 sheet "鍛樺伐涓氱哗鏄庣粏(鎸夌绾︿汉)" 6 鍒? 璺?PDF 瀛楁涓€涓€瀵瑰簲
- 鍒犱簡涔嬪墠鐨?鍛樺伐涓氱哗姹囨€? sheet (璺?KPI 鍗＄墖閲嶅, 璺?PDF 涓嶇)

**鏁版嵁鍙ｅ緞 (涓? 鏀圭敤绛剧害浜?*:
- 鏂板 `getSignerSummary` (鎸?signerId 鑱氬悎 鍚堝悓/寮€绁?鍥炴) 璺?`getSignerContractDetail` (鍚堝悓绾ф槑缁? 鍚岀淮搴?
- 鏃?`getEmployeePerformance` (鎸?ownerUserId 鑱氬悎) 寮冪敤, 浣嗕繚鐣欏吋瀹?(鏂?payload.signerSummary 浼樺厛)
- 璇︽儏椤?+ Excel + PDF 鍏ㄩ儴璧?绛剧害浜?鍙ｅ緞, 1 涓汉鍦ㄥ悓涓€寮犳姤琛ㄩ噷"姹囨€?+ 鏄庣粏"閫昏緫鑷唇

**绉婚櫎鑷姩鐢熸垚 (鍥? 绠€鍖?*:
- 璇︽儏椤佃繘鍏ヤ笉鍐嶉潤榛樺缓蹇収 (`getOrBuildSnapshot` 鎷嗕负 `findSnapshot` 鍙 + `generateSnapshot` 鏄惧紡鐢熸垚)
- 鎵句笉鍒板揩鐓ф椂杩?404 + 涓枃鎻愮ず, 鍓嶇璧?鏈敓鎴?绌烘€?+ 澶?绔嬪嵆鐢熸垚鎶ヨ〃"鎸夐挳
- 鍒?`server/jobs/report-snapshot.ts` + `runner.ts` 閲?cron 璋冪敤
- 淇濈暀 `scripts/shared/backfill-report-snapshots.ts` (涓€娆℃€ф墜鍔ㄨˉ鍘嗗彶鐢?
- 姣忔棩 0 鐐?cron 涓嶅啀鑷姩璺戞姤琛ㄧ敓鎴?

**API 鎷嗗垎 (浜?**:
- `POST /api/reports/snapshots` body 鍔?`action` 瀛楁: `snapshotId` 璧?`regenerateSnapshot`, `action=generate` 璧?`generateSnapshot`, 鍚﹀垯 `findSnapshot`
- `POST /api/reports/export` 鏀寔涓ょ妯″紡: `snapshotId` 璧板揩鐓? `code+periodType+from/to` 璧板疄鏃?(CUSTOM 鍛ㄦ湡姘镐笉鍐欏揩鐓? 浣嗕粛瑕佽兘瀵煎嚭)
- `server/services/report.ts` 鎷嗗嚭 `buildExportSectionsFromResult` helper, snapshot 鍜?live 涓ゆ潯璺緞鍏辩敤 section 鏋勯€?

**鏂囦欢鍚嶆椂闂存埑 (鍏?**:
- 鎵€鏈夊鍑烘枃浠跺悕缁熶竴 `YYYY-MM-DD_HHMM` 鏍煎紡 (绮剧‘鍒板垎), 閬垮厤鍚屾棩澶氭瀵煎嚭瑕嗙洊
- `lib/date-range.ts` 鏂板 `exportFileTimestamp()` helper, 鏈湴鏃跺尯
- 褰卞搷: reports / statistics / customers / payments / invoices / contracts 鍏?6 涓?export 璺敱
- PDF 鍙﹀瓨: print-html `<title>` 鍔?`_{periodLabel}_{ts}` 鍚庣紑, 娴忚鍣?鍙﹀瓨涓?PDF"瀵硅瘽妗嗛粯璁ょ敤杩欎釜鍚?
- Content-Disposition 鍚屾鍔?`filename="..."` (defensive, 缁欑洿鎺ヤ笅杞界殑瀹㈡埛绔?

**娴嬭瘯 (涓?**:
- `tests/api/reports.test.ts` 鈥?閲嶅啓涓?9 涓柊娴嬭瘯 (findSnapshot 404 / generateSnapshot 鍒涘缓 / hash skip / CUSTOM live / regenerate / permissions)
- `tests/api/reports-export.test.ts` 鈥?8 涓祴璇?(5 PDF 5 瀛楁 + 1 涓嶅啀鏈夋眹鎬?+ 2 瀹炴椂鏌ヨ)
- `tests/api/signer-contract-detail.test.ts` 鈥?3 涓柊娴嬭瘯 (瀛楁瀵归綈 + SALES 闅旂 + 鏉冮檺)
- 鍒?`tests/lib/report-period.test.ts` 閲?`previousPeriod` 鐩稿叧娴嬭瘯 (鍑芥暟涓€璧峰垹)

**鐢熶骇鏁版嵁**:
- 璺?`pnpm tsx scripts/shared/backfill-report-snapshots.ts --year 2026` 琛ュ叏 2026 骞?1-12 鏈堝揩鐓?(36 涓粍鍚? 6 鏈?7 鏈?Q3/骞?鏄凡鐢熸垚鐨?
- 2026-07-03 瀹炴祴 5鏈堝憳宸ヤ笟缁? 16 涓绾︿汉鍏?62 绗斿悎鍚? 鎬?410,880 鍏?(41.09 涓?, 璺?PDF 鏁版嵁瀹屽叏涓€鑷?

**鐗堟湰鍙?*: `0.7.0` 鈫?`0.8.0` (minor bump, 鏂板姛鑳戒负涓? 1 涓?breaking: 鎶ヨ〃涓績涓嶅啀鑷姩鐢熸垚)
**閮ㄧ讲璇存槑**: 鏃?schema 鍙樻洿, 鏃犳柊杩佺Щ; `prisma migrate deploy` 涓嶉渶瑕佽窇; `report-snapshot` cron job 宸蹭粠 `runner.ts` 绉婚櫎, `qt-jobs.cron` 娉ㄩ噴鍚屾鍘绘帀; 鐜版湁蹇収鏁版嵁鏃犻渶杩佺Щ

### v0.7.0(2026-07-03)搴旀敹璐﹂緞閲嶈璁?+ 鍌敹鍔熻兘

> 鍦?v0.6.0 浜嬫晠澶嶇洏涔嬪悗,缁х画鎺ㄨ繘"搴旀敹渚х殑鍙帶鎬?寤鸿銆傛湰娆′互 `Invoice.dueDate` + `DunningNote` 涓烘牳蹇?琛ラ綈璐﹂緞 / 鍌敹 / 璺熷崟鐨勫叏閾捐矾銆?

**鏂版ā鍨?(涓€) DunningNote**(8 瀛楁鍌敹璁板綍):
- `server/services/dunning.ts` + `prisma/schema.prisma` 鏂?model:`DunningNote` (`invoiceId` FK CASCADE 鈫?`Invoice`, `actorId` FK RESTRICT 鈫?`User` 闃?actor 璇垹)
- 瀛楁:`status` (CONTACTED / PROMISED / DISPUTED / LEGAL) / `promisedDate` / `lastContactAt` / `channel` (PHONE / WECHAT / EMAIL / VISIT) / `remark` / `actorId`
- 绱㈠紩:`(invoiceId)` / `(status)` / `(actorId, createdAt)`
- 涓氬姟璇箟: 鍗曚竴鍌敹鍔ㄤ綔 = 1 琛?DunningNote;PROMISED 鐘舵€佸～ `promisedDate`(瀹㈡埛鎵胯浠樻鏃?;鏈€杩戜竴娆¤仈绯?= `lastContactAt` 鐢ㄤ簬"璺濅笂娆¤窡杩?N 澶?鎻愰啋

**Schema 澧為噺 (浜?**:
- `Invoice.dueDate` (TIMESTAMPTZ, nullable): 鍚堝悓绾﹀畾浠樻鏃?璐﹂緞 `basis=due` 鐢?涓?null 鏃跺洖閫€ `actualIssueDate` 璁￠緞銆俙@@index([dueDate])` 鍔犲揩鎵弿
- `Contract.owner` 鍙嶅悜鍏崇郴琛ュ缓:涔嬪墠 `User.ownedContracts` 婕忛厤(鍙厤浜?`signedContracts`),瀵艰嚧 `ownerUserName` 娓叉煋璧?`String` fallback 鑰岄潪 `relation` join
- 杩佺Щ `20260703_aging_redesign`(鍗曚簨鍔?: `ADD COLUMN dueDate` + `CREATE TABLE DunningNote` + 3 绱㈠紩 + 1 FK + 鍥炲～(鍙湁 ISSUED 涓?dueDate 涓虹┖鐨勫彂绁?榛樿 `actualIssueDate + 30 澶ー,鍏跺畠鐘舵€佷繚鎸?NULL 绛夌敤鎴峰悗缁綍鍏?
- 鍏煎:涓嶅姩鍘嗗彶 migration,鍙柊澧炲璞?璺?`AGENTS.md` "涓嶅彲鍙樿縼绉? 瑙勫垯涓€鑷?

**API 璺敱 (涓? 7 鏉?*:
- `GET /api/statistics/aging/by-customer` 鈥?鎸夊鎴风淮搴﹀垎璐﹂緞妗?0-30/30-60/60-90/90+)
- `GET /api/statistics/aging/by-owner` 鈥?鎸夊悎鍚岃礋璐ｄ汉缁村害(缁?SALES 鎺掕 + ADMIN 宸℃)
- `GET /api/statistics/aging/trend` 鈥?璐﹂緞瓒嬪娍(瀵规瘮 7/30/90 澶╁墠蹇収)
- `GET /api/statistics/aging/uninvoiced-contracts` 鈥?鏈紑绁ㄥ悎鍚屾竻鍗?璐﹂緞鍩轰簬鍚堝悓姝㈡湡)
- `GET/POST /api/statistics/aging/dunning-notes` + `[id]` 鈥?鍌敹璁板綍 CRUD(REST 椋庢牸)
- `GET /api/statistics/aging/dunning/summary` 鈥?鍌敹姹囨€?姣忓紶鍙戠エ鐨勬渶杩?N 鏉″偓鏀?

**缁勪欢 (鍥? 4 涓?*:
- `components/aging-summary.tsx` 鈥?4 妗ｈ处榫勬眹鎬诲崱鐗?鎬诲簲鏀?/ 0-30 / 30-60 / 90+)
- `components/dashboard-aging-mini.tsx` 鈥?dashboard 宓屽叆鐨勮糠浣犺处榫勮鍥?
- `components/dunning-drawer.tsx` 鈥?鍌敹鎶藉眽(璇︽儏椤?鍒楄〃椤靛唴宓?灞曠ず + 鏂板鍌敹璁板綍)
- `components/authority.tsx` 鈥?`<Authority>` 閫氱敤鏉冮檺鍖呰(鏇挎崲 `lib/permissions.ts` 鏃?`useCanX` 绯诲垪,缁熶竴鍓嶇鏉冮檺娓叉煋)

**缁熻椤垫敼閫?(浜?**:
- `app/(app)/statistics/aging/page.tsx` 鈥?700+ 琛岄噸鍐?鏂颁氦浜?瀹㈡埛 / 璐熻矗浜哄弻缁村害鍒囨崲 + 鍌敹鍏ュ彛
- `app/(app)/statistics/by-region/page.tsx` / `performance/page.tsx` 鈥?寰皟鑱斿姩
- `app/(app)/dashboard/page.tsx` 鈥?鍔?aging mini
- `app/api/statistics/export/route.ts` / `invoice-aging/route.ts` 鈥?瀵煎嚭 + invoice aging API 閫傞厤 dueDate basis

**鍩虹璁炬柦 (鍏?**:
- `lib/permissions.ts` 鈥?鍔?9 琛屾柊璧勬簮/鍔ㄤ綔鐨勬潈闄愭槧灏?STATISTICS.AGING_READ, DUNNING.*)
- `lib/i18n.ts` 鈥?鍔?150+ 琛?dunning / aging / authority 璇嶆潯
- `components/callout.tsx` 鈥?寰皟
- `server/services/statistics.ts` 鈥?581 琛岄噸鍐?缁熶竴 dueDate basis 鎶借薄

**娴嬭瘯 (涓?**:
- `tests/api/aging.test.ts` / `aging-api.test.ts` / `dunning.test.ts` 鈥?鍗曟祴瑕嗙洊 3 澶?API + 杈圭晫(dueDate null 鍥為€€ / cascade delete / force actor)
- `tests/api/statistics-aggregation.test.ts` 鈥?鍔?41 琛屾柊鍦烘櫙
- `tests/e2e/15-aging-redesign.spec.ts` 鈥?Playwright 绔埌绔?璇︽儏椤垫墦寮€鍌敹鎶藉眽 + 褰曞叆鍌敹 + 鍒楄〃鏄剧ず)

**鏂囨。 (鍏?**:
- `docs/DESIGN-v3.md` 鈥?鍔?59 琛?璐﹂緞閲嶈璁?+ DunningNote 瀹炰綋 + dueDate basis 瑙勫垯)
- `docs/USER_MANUAL.md` 鈥?鍔?27 琛?璐﹂緞椤典娇鐢?+ 鍌敹娴佺▼ + Authority 缁勪欢鐢ㄦ硶)

**鐗堟湰鍙?*: `0.6.0` 鈫?`0.7.0`(minor bump,鏂板姛鑳?+ 鏂?schema,鏃?breaking change)
**閮ㄧ讲璇存槑**: 鍚?1 涓柊杩佺Щ(`20260703_aging_redesign`),鍚?DunningNote 琛ㄥ垱寤?+ Invoice.dueDate 鍔犲垪 + 鍥炲～;棣栨閮ㄧ讲鍚?ISSUED 鍙戠エ鐨?dueDate 浼氳鑷姩鍥炲～涓?`actualIssueDate + 30 澶ー,璐㈠姟鍙湪寮€绁ㄥ鏍告椂鎵嬪姩瑕嗙洊

### v0.6.0 (2026-06-29) cron 闈欓粯澶辫触 9 涓湀浜嬫晠澶嶇洏 + 杩愮淮鐩戞帶 + 淇

> 2025-09 ~ 2026-06-28 鏈熼棿 cron 闈欓粯澶辫触 9 涓湀鏃犱汉瀵熻,鎭㈠鍚?`tryAutoCloseOnOverdue` 鎵归噺寮哄叧 209 涓?overdue_terminated 鍚堝悓 + 31 涓?admin 璇叧 + 2 涓?completed 寮傚父 = 鍏?242 涓?CLOSED 鍚堝悓 269 涓囧簲鏀惰閿佹銆傛湰娆″彂鐗堜互"淇 + 闃插啀鍙?涓烘牳蹇冦€?

**淇 (涓€) reopen + force 鏃佽矾** (`4502f182`)锛?

- **feat(contract)**:鏂板 `POST /api/contracts/[id]/reopen` 鎺ュ彛, admin 涓撳睘, CLOSED 鈫?ACTIVE銆? 妗?`reason` 鏋氫妇 (`recovered_from_fake_close` / `data_correction` / `reopen_for_payment` / `other`, `other` 蹇呭～ `reasonNote`), 瀹屾暣浜嬪姟 + `ContractReviewLog` (`action=MANUAL_REOPEN`) + audit log + `reviewComment` 鏍囪 `reopened:<reason>` 渚夸簬杩芥函
- **feat(payment)**: `createPayment` 鍔?`force: true` / `forceReason` 鏃佽矾, 浠?ADMIN 鍙敤, 浠?CLOSED 鍚堝悓鍏佽, 涓氬姟鏍￠獙淇濈暀 (閲戦/鍙戠エ), `remark` 鑷姩杩藉姞 `[FORCE_BACKFILL:<reason>]` 瀹¤鏍囪
- **feat(api)**: `POST /api/payments` body 鍔?`force + forceReason` overlay (涓嶈繘 `PaymentCreateInput` 涓?schema, 閬垮厤姹℃煋鍓嶇绫诲瀷)
- **docs**: postmortem `docs/cron-silent-failure-postmortem.md` (瀹屾暣澶嶇洏 + 楸奸鍥?+ 淇鏃堕棿绾? + `docs/contract-fake-close-recovery.md` (淇鏂规 + 閫夋嫨鎸囧崡) + `scripts/migrate/contract-fake-close-recovery.{sql,ts}` (浜嬪姟 + 澶囦唤 + 瀹¤ + 鍥炴粴 SQL)
- **閮ㄧ讲璁板綍**: 2026-06-29 宸叉墽琛屾仮澶嶈剼鏈? 242 涓悎鍚屽凡鎭㈠ ACTIVE, 璐㈠姟鍙ˉ褰曞洖娆?

**闃插啀鍙?(浜? cron 鍋ュ悍鐩戞帶** (`af734c28`)锛?

- **feat(ops)**: `scripts/ops/cron-healthcheck.sh` (183 琛? 鈥?姣忓皬鏃剁 5 鍒嗛挓璺戠殑鑷鑴氭湰, 4 缁村害妫€鏌?(crond 鏈嶅姟 / qt-cron.log 鏈€杩?2h 鍐欏叆 / qt-app 3000 绔彛 / PostgreSQL 瀹瑰櫒 healthy), 澶辫触鍐欐棩蹇?+ 鍙€夐涔?webhook 鍛婅
- **chore(ops)**: `ops/qt-jobs.cron` 鍔?`5 * * * * cron-healthcheck.sh` 鏉＄洰 (璺?`0 * * * * run-all` 閿欏紑, 闃叉浜掔浉骞叉壈)
- **feat(deploy)**: `scripts/prod/deploy.sh` 鍔?deploy 鍚庤嚜妫€ 鈥?`/etc/cron.d/qt-jobs` 蹇呴』鍚?`source .env` + 绔嬪嵆瑙﹀彂 `run-all` 楠岃瘉 token + 璺戜竴娆?`cron-healthcheck.sh` (闃?deploy 闈欓粯 break cron)
- **feat(events)**: `server/events/bus.ts` `CONTRACT_EXPIRED_UNPAID` 鏂囨鍒嗘。 鈥?`daysUntilForceClose` 鈭?{7, 3, 1} 绾㈣壊閱掔洰 `鈿狅笍銆愬己鍏抽璀︺€慲 + 绔嬪嵆澶勭悊鎸囧紩; = 0 鏃?`鈿狅笍 浠婂ぉ灏嗚绯荤粺寮哄叧`; 鍏跺畠鏅€?`杩樺墿 N 澶ー
- **docs**: `docs/USER_MANUAL.md` 鏂板 搂16 杩愮淮灏忚创澹?(30 绉掕嚜妫€ / 鍋ュ悍鐩戞帶 / 寮哄叧鏂囨瑙勫垯 / deploy 鎶ラ敊鎺掓煡 / 搴旀€ュ鐞嗗叆鍙?

**閫夋嫨鎸囧崡 (涓? postmortem 琛?reopen vs force** (`c959b300`)锛?

- **docs(postmortem)**: `docs/contract-fake-close-recovery.md` 鏂板 搂4.4 / 搂4.5 鈥?4 妗ｅ吀鍨嬪満鏅搴旀帹鑽愯矾寰?(鍘嗗彶鎵归噺 鈫?SQL / 鍗曞悎鍚岃鍏?鈫?reopen / CLOSED 琛ュ綍 鈫?force / DRAFT 鎷掔粷), 鍏抽敭鎻愰啋 (reopen 鍚?cron 浠嶅彲鑳藉啀娆″己鍏? 姝ｇ‘娴佺▼鏄?reopen 鈫?绔嬪嵆琛ュ綍 鈫?tryAutoComplete), 鎺ュ彛 curl 绀轰緥

**瀹℃煡淇 (鍥?** (`dd3cfa29`)锛?

- **fix(contract)**: 鍚堝悓鎿嶄綔鏃ュ織 Timeline SUCCESS 琛?`CheckCircleFilled` (`var(--ant-color-success)`) icon, 璺?FAILURE 鐨?`CloseCircleFilled` 瀵圭О
- **chore(contract)**: `reopen` route 鏂囦欢鏈熬琛?newline (diff 鏍?`\ No newline at end of file`, eslint 璀﹀憡)
- **fix(statistics)**: by-region 鏌辩姸鍥?`groupedChartData` 鍔?`fullName` 瀛楁, tooltip.title 鏄剧ず瀹屾暣"鍖?+ 琛楅亾"缁勫悎 (瑙ｅ喅璺ㄥ尯鍚屽悕闀囪鍦?X 杞撮噸澶嶆潯鐩毦鍖哄垎)

**浠ｇ爜娓呯悊 (浜?** (`07324d63`)锛?

- **refactor(lib)**: 鎶?`serviceTypeLabel(value: unknown): string` helper (lib/enum-maps.ts), 鏇挎崲 5 澶勬暎钀界殑 `SERVICE_TYPE_MAP[v] ?? v ?? "鈥?` 鍐欐硶 (瀹㈡埛璇︽儏鍚堝悓 tab / 浠樻璇︽儏 / 鍚堝悓璇︽儏 / xlsx 瀵煎嚭 / PDF 瀵煎嚭), 瀹㈡埛绔?鏈嶅姟绔€氱敤, 鏈潵鏂板 serviceType code 涓嶄細婕忔敼

**璐ㄩ噺鍩虹嚎**锛歵ypecheck 0 閿欒, lint 0 warning, vitest 56 鏂囦欢 / 452 娴嬭瘯鍏ㄨ繃, deploy smoke test 鍏ㄧ豢, post-deploy cron-healthcheck 5 缁村害鍏?OK

**閮ㄧ讲鏈熺壒鍒彁閱?*锛氭湰娆?deploy.sh 宸茶嚜鍔ㄨ窇 cron 鑷, 浣?`cron-healthcheck.sh` 鏄柊鍔犺剼鏈? 鏈嶅姟鍣?*棣栨瀹夎**闇€瑕佹墜宸ユ墽琛岋細

```bash
sudo cp /opt/qt/ops/qt-jobs.cron /etc/cron.d/qt-jobs
sudo chmod 644 /etc/cron.d/qt-jobs
sudo systemctl restart crond
/opt/qt/scripts/ops/cron-healthcheck.sh --verbose  # 楠岃瘉
```

鍚庣画 deploy 浼氳嚜鍔ㄩ獙璇?`cron-healthcheck.sh --once`, 涓嶄細鍐?瑁呭畬蹇樿"銆?

### v0.5.1+ (2026-06-29) 澧為噺灏忎慨

> 鏈妭姹囨€?v0.5.1 涔嬪悗銆丠EAD 涔嬪墠鐨勬墍鏈?commit(16 涓?銆傝鐩栧鎴风姸鎬佹満涓嬬嚎鍚庣殑娓呯悊銆佸鎴风粺璁″尯闂村寮恒€佺郴缁?actor 鑷姩鐘舵€佹満銆佸悎鍚岄粯璁よ礋璐ｄ汉銆佽瘉涔﹂〉 bug銆佽縼绉绘紓绉绘仮澶嶃€丄I 鍥㈤槦閰嶇疆銆?

- **feat(dashboard)**:缁熻鍖洪棿鏀寔鏈堝害 / 瀛ｅ害 / 骞村害鍒囨崲(`StatisticsRange` 鏂版灇涓?椤堕儴 Tab 涓?URL `?range=` 鍚屾,鍚庣 `getOverview({ range })` 鍏ュ弬)
- **refactor(dashboard)**: `customers.newThisMonth` 鈫?`newInRange`(璇箟瀵归綈缁熻鍖洪棿,Top 瀹㈡埛涓?dashboard 涓€鑷?
- **fix(customer)**:璇︽儏椤?`select` 绉婚櫎 v0.5.0 宸插垹鐨?`status / lastAutoAppliedAt` 瀛楁
- **fix(seed)**:seed upsert system actor(`id=system`)鈥斺€?鑷姩鐘舵€佹満杞崲闇€瑕?`actorId`,鍚﹀垯 `tryAutoComplete` / `tryAutoCloseOnExpiry` 鎶涘閿敊
- **fix(contract)**:`SALES` 鍒涘缓鍚堝悓鏃?`ownerUserId` 榛樿 = 褰撳墠 user,涓庤鎯呴〉 `ownerUserId` 涓€鑷?琛?`tests/unit/server/contract-create.test.ts` 鐢ㄤ緥
- **chore(contract)**:鍚堝悓 Timeline 鍒?antd 6 API(`TimelineItem dot` 鈫?`dot` 鎺ュ彈 ReactNode),澶辫触鐘舵€佸姞绾?icon
- **chore(payments)**:娓呮湭浣跨敤鐨?`Tag` 瀵煎叆(antd 6 lint 璀﹀憡)
- **fix(certificates)**:鍒版湡璇佷功椤?`request` 瑙ｅ寘閿欎綅(`response` 浜屽眰鍖?鈫?鐩存帴璇?`data.items`
- **chore(db)**:鎭㈠婕傜Щ鐨?3 涓縼绉绘枃浠?浠?git 鍘嗗彶鎵惧洖,涓嶈兘 `migrate resolve` 鍑┖鏍囪),鍔?`docs/db-bootstrap.md` + `prisma db-schema-snapshot.sql` 鍏滃簳鑴氭湰
- **chore(deps)**:`dev / test / typecheck` 鍔?`predev` 閽╁瓙鑷姩 `prisma generate`,鍏嶆墜鍔?build 婕忔帀 client
- **feat(dev)**:鐧诲綍椤垫祴璇曡处鍙峰榻?5 涓唴缃鑹?鍘?4 涓?鍔?`expert` 鐢ㄤ簬鏉冮檺鐭╅樀娴嬭瘯,涓嶈繘蹇€熷～鍏呭崱)
- **chore(harness)**:鍒濆鍖?Mavis 鍥㈤槦閰嶇疆(`.harness/` + `AGENTS.md`),`harness / developer / prisma-expert / backend-expert / ui-expert / code-reviewer` 6 涓?rein,璇﹁ [.harness/agent.md](.harness/agent.md)

### v0.5.1(2026-06-28)Excel 瀵煎嚭鏂囦欢鍚嶅浗闄呭寲 + 鍚堝悓閫夋嫨鍣ㄥ寮?

灏忕増鏈泦涓慨 8 涓?xlsx 瀵煎嚭绔偣(缁熻 4 / 鍚堝悓 / 瀹㈡埛 / 鍥炴 / 寮€绁?鐨?`Content-Disposition` 涓枃鏂囦欢鍚?+ 瀹㈡埛绔?`downloadExcel` 瑙ｆ瀽銆傛秹鍙?[lib/excel.ts](lib/excel.ts) 鏂板 `attachmentHeader()`,[app/api/statistics/export/route.ts](app/api/statistics/export/route.ts) 绛?8 涓鍑鸿矾鐢?+ [app/api/files/raw/[id]/route.ts](app/api/files/raw/%5Bid%5D/route.ts) 鏂囦欢涓嬭浇銆?

- **fix(statistics)**:`鍖哄煙缁熻` 绛変腑鏂?xlsx 鏂囦欢鍚嶅湪 Node `Headers` API 鎶?`TypeError: Cannot convert argument to a ByteString`(byte 22, value 21306)鈫?500銆傜粺涓€鏀?`attachmentHeader()` 璧?`filename=ASCII_fallback; filename*=UTF-8''<percent-encoded>` 鍙屽舰寮?鑰?IE 鎷?ASCII銆佺幇浠ｆ祻瑙堝櫒鎷?UTF-8銆傚悓姝ヨ鐩?`/api/files/raw/[id]` 鏂囦欢涓嬭浇(`originalName` 涔熸槸涓枃,鍚屼竴鏍瑰洜)
- **feat(form)**:鏂板缓寮€绁?/ 鐧昏鍥炴鐨勫悎鍚?`ProFormSelect` option label 鎷兼帴 `鍚堝悓鍙?路 鍚堝悓鏍囬 路 鍚堝悓鎬婚`,涓嬫媺鎼滅储鏃跺彲涓€鐪肩湅鍒板悎鍚岄噾棰?`Contract` 绫诲瀷琛?`totalAmount: string` 瀛楁
- **fix(payment)**:鐧昏鍥炴 `FormCard` headerHint 娓叉煋 `鍚堝悓锛歶ndefined(瀹㈡埛鍚?`,鏍瑰洜鏄?`onChange` 鎷?`pickedContract` 鏃舵紡濉?`contractNo`銆俹ption 鏀规垚 `contract: c` 鏁翠唤鍚堝悓濉炲叆,`setPickedContract(o?.contract ?? null)`,浠ュ悗鎵╁瓧娈典笉浼氬啀韪?
- **refactor(invoice)**:寮€绁ㄨ〃鍗曞悎鍚岄€夋嫨鍣?option 鍚屾瀵归綈鎴?`contract: c` 鍐欐硶,onChange 浠?`o.contract?.customerId` 鍙栧€?涓ゅ紶琛ㄥ崟缁撴瀯缁熶竴
- **refactor(client)**:`lib/excel-client.ts` 鐨?`downloadExcel` 瑙ｆ瀽 `Content-Disposition` 涔嬪墠鐢?`/filename=([^;]+)/` 鎷垮埌 ASCII 鍏滃簳鑰屼涪鎺変腑鏂?鏀规垚浼樺厛 `filename*=UTF-8''` + `decodeURIComponent`,fallback 鎵嶉€€鍒?ASCII;涓変釜缁熻椤?鎬昏/Top 瀹㈡埛/鍖哄煙/鍛樺伐涓氱哗)鏀圭敤 `downloadExcel(url)`,鏂囦欢鍚嶄互鏈嶅姟绔?`Content-Disposition` 涓哄崟涓€鏉ユ簮,鍒犳墜鍐?`<a download="涓枃.xlsx">`
- **test(unit)**:`tests/unit/lib/excel.test.ts` 鍔?4 鏉?`attachmentHeader` 鍗曟祴(涓枃 / 绾?ASCII / 甯︾┖鏍?/ `encodeURIComponent` round-trip),11/11 閫氳繃;绔埌绔獙璇?8 涓鍑虹鐐?200,鏂囦欢鍚嶅潎甯︿腑鏂?

### v0.5.0(2026-06-29)瀹㈡埛鐘舵€佹満涓嬬嚎(纭垹)

涓氬姟鍙嶉 v0.4.0 涓婄嚎鐨勫鎴风姸鎬佹満(5 鎬?+ 4 鏉¤嚜鍔ㄨ鍒?+ 7 澶╁彲鎾ら攢妯箙)璇箟涓嶆竻 / 鑷姩鍖栬鍒欏父璇垽, 鏁翠綋纭笅绾裤€傝璁? [docs/superpowers/specs/2026-06-29-customer-status-deprecation.md](docs/superpowers/specs/2026-06-29-customer-status-deprecation.md)銆?

- **chore(customer)**:鍒?`Customer.status / lastAutoAppliedAt / lastAutoRule` 3 鍒?+ `@@index([status])` (`Customer_status_idx`); 鍒?`enum CustomerStatus`(5 鎬?; migration `20260629_drop_customer_status`(`DROP INDEX IF EXISTS` + `DROP COLUMN IF EXISTS`, idempotent, 鐘舵€佸垪 v0.4.0 璧蜂负 String 鏁呮棤闇€ backfill)
- **chore(lib)**:鍒?`lib/customer-status-transitions.ts` / `lib/customer-auto-rules.ts`; `lib/{status,dict-domain,dictionary-categories,use-status-enum,validators/customer,env,customer-update}.ts` 绉婚櫎 `customer` StatusDomain 寮曠敤 / 瀛楀吀 / 鏍￠獙瀛楁 / 閿欒鐮?`CUSTOMER_STATUS_TRANSITION_INVALID` / `CUSTOMER_AUTO_*`
- **chore(server)**:鍒?`server/services/customer/{status,automation}.ts` + `server/services/customer-status.ts` + `server/jobs/customer-status-suggest.ts`; 鏀?`server/services/customer/{crud,index}.ts` / `server/services/contract/{crud,status}.ts` / `server/jobs/runner.ts` / `server/events/bus.ts` / `server/services/statistics.ts` 绉婚櫎澶栧彂璋冪敤
- **chore(api)**:鍒?`POST /api/customers/[id]/revert` 璺敱; 鏀?`GET/PATCH /api/customers/[id]` / `GET /api/customers/export` / `GET /api/jobs/[job]` / `GET /api/statistics/overview` 绉婚櫎澶栧彂
- **chore(ui)**:鍒?`components/customers/auto-status-banner.tsx`; 璇︽儏椤?鍒楄〃椤?琛ㄥ崟绉婚櫎銆屽彉鏇寸姸鎬併€嶅叆鍙?+ 鎾ら攢妯箙; 瀹㈡埛 PDF 鏀圭敤鍚堝悓绾х姸鎬?
- **chore(types|events|errors)**:`MessageType` enum 3 涓?`CUSTOMER_STATUS_*` 鍊?*淇濈暀**(鍘嗗彶娑堟伅 fallback); `bus.ts` `default` 鍒嗘敮娓叉煋涓恒€屽巻鍙叉秷鎭€? `operation-log-format.ts` `CUSTOMER_STATUS_*` action 杩?null
- **refactor(schema)**:璺ㄦā鍧楁牎楠?R-02 / R-03 / R-13 鍒? R-16 鎸囧悜 `lib/status-machine.ts`(閫氱敤鎶借薄, 浠?4 瀹炰綋鍏辩敤)
- **chore(tests)**:鍒?`tests/{api,unit,unit/server}/customer-status*.test.ts` + `tests/e2e/08-customer-status.spec.ts`; 淇?5 涓?contract-* test + `customers-patch` / `customer-update` / `validators/customer` / `events-bus` / `contract-create-validation` / `customer-contract-overview-ownership` / e2e `05-invoice-payment-flow`
- **chore(docs)**:DESIGN-v3 搂5.5 鈫?deprecation 閾炬帴; PROJECT_SUMMARY 搂3.3.2 鈫?绠€鍖栦负 deprecation 鎬荤粨; USER_MANUAL 搂5.1 鐘舵€佽〃 / 搂5.6 瀹㈡埛鐘舵€佽嚜鍔ㄨ仈鍔?/ FAQ Q5 鍏ㄥ垹; README 鍒?搂3 瀹㈡埛鐘舵€佹満鑺?+ 鍒?R-02/R-13; v0.4.0 spec `2026-06-28-customer-status-automation.md` 绉诲叆 `docs/superpowers/specs/_archive/`
- **test**:vitest 425/425(54 files, -14 customer-status 鐢ㄤ緥); typecheck 0 error; eslint 0 warning; 鍚庣画 e2e(璺宠繃 08-customer-status)寰?commit 鍓嶈窇

鎻愪氦 `BREAKING CHANGE` 涓€娆℃€у悎骞?鍗?commit, 娑电洊鎵€鏈?schema/lib/server/api/ui/types/tests/docs 鏀瑰姩)銆?

### v0.3.1(2026-06-26)鍛樺伐妗ｆ + 璇佷功鍒版湡 cron + 璧勪骇涓嬬嚎 + 瀵艰埅閲嶆瀯

- **feat(employee-profile)**:`EmployeeProfile` 琛?+ 5 寮犲瓙琛?鏁欒偛/璇佷功/宸ヤ綔缁忓巻/鍚堝悓/瀹跺涵鎴愬憳),`Attachment.category` 瀛楁,`MessageType.CERTIFICATE_EXPIRING` 鏋氫妇鍊?
- **feat(employee-profile)**:PR7-PR11 浜旀壒 鈥?鎵归噺鎿嶄綔 + 鍚戝/瀛愯〃鎵撶（ + E2E 瑕嗙洊 + P0 闃诲淇 12 椤?+ 鐢ㄦ埛鎵嬪唽 v0.4 閲嶅仛
- **feat(certificate)**:璇佷功鍒版湡 cron 30/15/7 妗?`certificate-expiry-check`)+ 鍒楄〃椤?+ 鐢ㄦ埛鍒楄〃 badge
- **chore(refactor)**:涓嬬嚎鍏徃璧勪骇搴?CompanyAsset)妯″潡 鈥?DROP CompanyAsset + DROP Attachment.assetId/isPrimary + DROP POLICY + DELETE 瀛楀吀 ASSET_TAG(璧勪骇妯″潡鐢熷懡鍛ㄦ湡 13 澶?
- **feat(message)**:Message.type 浠?text 鏀剁揣鍒?enum MessageType(7 鏋氫妇鍊?,鍔?type+receiverUserId+createdAt 澶嶅悎绱㈠紩
- **refactor(nav)**:缁熶竴杩斿洖鎸夐挳璧?`useGoBack()` hook(娴忚鍣ㄥ巻鍙蹭紭鍏?+ fallback 鍏滃簳),鍒?30+ 澶勭‖缂栫爜 `router.push('/x')`;璇︽儏椤?5 鍒嗙粍鍚堝苟涓?ProfileHero + 鍗＄墖缃戞牸
- **fix(nav)**:娑堟伅涓績 PageHeader 鍔?type='navigation' 鎻愮ず
- **fix(lint)**:antd 鏂?API 鈥?`Space direction='vertical'` 鈫?`orientation='vertical'`
- **fix(dashboard)**:summary 鎺ュ彛鎶?range 濉炶繘 overview 杩斿洖
- **fix(statistics)**:鍛樺伐涓氱哗椤甸粯璁ゆ湰鏈堝尯闂?涓?dashboard 涓€鑷?
- **fix(invoice)**:寮€绁ㄤ繚瀛?applyDate 鏀圭敤 dayjs().toISOString() 鍏煎 string/dayjs
- **fix(invoice-new)**:鍚堝悓涓嬫媺 pageSize 100 鈫?1000
- **fix(contract-export)**:鏂板椤圭洰璐熻矗浜哄垪,绛捐浜?璐熻矗浜哄彧鏄剧ず濮撳悕
- **fix(users)**:璇︽儏椤靛垹鍙充晶 Anchor 瑙ｅ喅 active 涓嶅悓姝?SWR 澶氳В涓€灞?淇?DepartmentTreeSelect 闆嗘垚;鍔犱繚瀛樻寜閽?skeleton 姘歌繙鍗℃
- **test(e2e)**:鍦烘櫙 14 - 鍛樺伐妗ｆ CRUD + 闄勪欢涓婁紶绔埌绔鐩?
- **chore(test)**:鍒?`tests/e2e/13-employee-batch-ops.spec.ts`(澶氶€夐摼璺凡绉婚櫎)

**閮ㄧ讲鏈熻瀵?*:6 涓柊杩佺Щ鍦?v0.3.0 鈫?v0.3.1 涔嬮棿鎵嬪伐搴旂敤(`20260630_message_type_enum_index` 璇?3 娆℃墠鎴愬姛),鏈 1 commit `b2e9f1bdf` 鏄函 refactor,deploy.sh 涓€閿窇銆傝瑙?`docs/閮ㄧ讲璁板綍 鈥?qt-biz v0.1.0 鈥?Aliyun ECS.md` v0.3.1 鑺?

**宸茬煡闂**:`contract-auto-complete` job 鍋跺彂 `TransactionWriteConflict`(PostgreSQL 40001,鍗曞疄渚?3.5G 鏈哄櫒鏃犲垎甯冨紡閿?193 琛屾壂鎻忛噷 1 鏉″け璐?;job 缂?retry loop,v0.3.2 / v0.4.0 璺熻繘

### v0.3.0(2026-06-24)浼佷笟璧勪骇搴撴ā鍧椾笅绾?

> 娌跨敤 `20260623_drop_project_and_workflow` 鐨勭‖涓嬬嚎妯″紡:鍒犺〃 + 鍒犱唬鐮?+ 鍒犳潈闄?+ 鍒犺彍鍗曘€傝瑙?`prisma/migrations/20260628_drop_company_assets/`銆乣lib/permissions.ts`銆乣components/dashboard-shell.tsx`銆?

- **chore(asset)**:`CompanyAsset` 琛?+ `Attachment.assetId/isPrimary` 鍒?DROP,`RESOURCE.ASSET` 涓?5 瑙掕壊 ASSET 鏉冮檺鐭╅樀鍥炴敹,`asset-expiring` 瀹氭椂浠诲姟 / `ASSET_EXPIRING` 娑堟伅閾捐矾鎷嗛櫎
- `app/(app)/assets/`銆乣app/api/assets/`銆乣components/assets/`銆乣server/services/asset{,-stats,-expiry-job}.ts`銆乣lib/{assets,validators/asset}.ts`銆乣prisma/seed-assets.ts` 鏁寸洰褰?鏂囦欢绉婚櫎
- `ASSET_TYPE` / `ASSET_STATUS` / `ASSET_TYPE_MAP` / `ASSET_STATUS_MAP` / `ASSET_*` 閿欒鐮?/ `menu.assets` / `asset.*` i18n 鍏ㄩ儴娓呮帀
- 3 涓?`seed:assets` / `migrate:asset-primary-attachments[:dry]` npm script 绉婚櫎
- `ASSET_TAG` 瀛楀吀鐧藉悕鍗曚笌 seed 鍚屾娓呮帀

### v0.3.0(2026-06-24)缁熻鍒嗘瀽 round-2 鏀跺熬

璇﹁ [docs/P2_REVIEW.md](docs/P2_REVIEW.md) 鏈熬 Round-2 淇鑺傘€乕docs/DESIGN-v3.md](docs/DESIGN-v3.md) 搂8 / 搂9.7銆乕docs/USER_MANUAL.md](docs/USER_MANUAL.md) 搂11銆?

- **chore(statistics)**:round-2 宸ュ叿涓庤剼鏈叆搴?鈥?`lib/date-range.ts` 缁熶竴鍓嶅悗绔棩鏈熻寖鍥?`scripts/dev/seed-customers-contracts.ts` dev 娴嬭瘯鏁版嵁,`scripts/shared/cleanup-minio-objects.ts` MinIO 妗舵竻鐞?
- **test(statistics)**:`tests/api/statistics-aggregation.test.ts` 4 鏉＄湡瀹?DB 闆嗘垚鏂█(璐﹂緞 total / REFUNDED 鎶垫秷 / unpaidAmount clamp / SALES short-circuit)
- **fix(statistics)**:淇 `unpaidAmount === 0` 鏂█(鏀圭敤 delta 娉曢獙璇?clamp 琛屼负)
- **chore**:鍒犻櫎 `tests/e2e/99-debug-spacing.spec.ts`(寮曠敤宸蹭笅绾跨殑 `/assets/new?type=PERFORMANCE`)

### v0.3.0(2026-06-23)鍚堝悓 7鈫? 鐘舵€佹満 + 椤圭洰/宸ヤ綔娴佹ā鍧楀垹闄?

- **chore(workflow)**:褰诲簳鍒犻櫎椤圭洰绠＄悊鍜屽伐浣滄祦寮曟搸妯″潡 鈥?Project / WorkflowTemplate / WorkflowStage / WorkflowTask / WorkflowTaskInstance 浜斿紶琛?DROP,5 涓?dict 绫诲埆 `PROJECT_STATUS` 绉婚櫎,12 涓?dead 璺敱鏀?410 Gone,`action` 8鈫?,娓呮帀 ~50 涓?dead 瀛楁/璺敱/鏂囦欢
- **refactor(contract)**:鍚堝悓鐘舵€佹満 7 鎬?鈫?3 鎬?DRAFT / ACTIVE / CLOSED)銆係QL 杩佺Щ甯︽柇瑷€(澶辫触浼氬洖婊?+ 澶囦唤鍒?`_Contract_status_simplify_bak`;`migrate:contract-status-dict` 杞仠鐢?6 鏃?code + upsert 3 鏂?code銆?668 鍚堝悓涓€娆℃€ф敹鏁?524 ACTIVE / 4109 CLOSED / 35 DRAFT)
- **feat(contract)**:鍚堝悓鑷姩鐘舵€佹満 鈥?`contract-auto-publish`(DRAFT 瀛楁瀹屾暣+闄勪欢 鈫?ACTIVE)鍜?`contract-auto-complete`(ACTIVE 寮€绁ㄨ冻棰?鈫?CLOSED)涓や釜 cron job 钀藉湴
- **feat(customer)**:瀹㈡埛鐘舵€佹満 鈥?瀛楁 `status` (ACTIVE / INACTIVE / PENDING) + 鏈嶅姟灞傝鍒?v0.4.0 鍗囩骇涓?5 鎬? v0.5.0 鏁翠綋涓嬬嚎)
- **feat(announcement,message)**:鍏憡璇︽儏椤?+ 娑堟伅鏈璁℃暟 + 浜嬩欢鎬荤嚎鏀舵暃
- **feat(invoice,payment)**:鍙戠エ/鍥炴璇︽儏椤电敤 enum map 鏄剧ず涓枃鏍囩
- **feat(jobs)**:鍔?`/api/jobs/contract-expiry` 鍗曡窇绔偣
- **fix(invoice)**:R-08 绱寮€绁ㄥ寘鍚?DRAFT,閬垮厤瓒呴鍒涘缓鑽夌
- **chore(refactor)**:6 鏈堜笟鍔℃敹绱?鈥?鍒?`Project.budgetAmount` + `PaymentAllocation` + OperationLog 瀹¤瀛楁;6 涓?ts-nocheck 鍏ㄩ儴娓呴€€
- **feat(data)**:鏃?FineUI MySQL 鏁版嵁杩佺Щ CLI 钀界洏

閮ㄧ讲鏈?hotfix(`6c3cd090`):Zod v4 `.partial()` 涓嶅厑璁稿湪鍚?`.refine()` 鐨?schema 涓?鈥?`lib/validators/announcement.ts` 鎷嗗嚭 `announcementFields` 鍗曠偣鐪熺悊;`20260626_invoice_attachments_json` 鍔?`IF NOT EXISTS` 骞傜瓑銆?

### v0.2.0(2026-06-22)鍚堝悓/椤圭洰鏀剁揣 + 涓氬姟绾寲

> 娉?v0.3.0 涔嬪悗姝ょ増鏈紩鍏ョ殑"椤圭洰"鍔熻兘宸茶鍒犻櫎,浠ヤ笅璁板綍淇濈暀浣滃巻鍙插弬鑰冦€?

- **feat(contract)**:鍚堝悓绠＄悊鏂板銆岃礋璐ｄ汉銆嶅瓧娈?鍒涘缓/缂栬緫鍙粠鍛樺伐鍒楄〃閫変换鎰?ACTIVE 鍛樺伐,榛樿缁ф壙 `customer.ownerUserId`
- **feat(project)**:椤圭洰璇︽儏椤?admin-only 鍒犻櫎鎸夐挳(鐘舵€侀棬鎺?`PLANNED / CANCELLED`,绾ц仈杞垹 `WorkflowTaskInstance` + `ProjectProgressLog`)銆倂0.3.0 鍚庨殢椤圭洰妯″潡鏁翠綋涓嬬嚎
- **feat(payment)**:鍥炴鍒楄〃鍏抽敭瀛楁悳绱㈡墿鍒般€屽鎴峰悕绉般€?
- **refactor(clean-up)**:椤圭洰鍥炲綊绾笟鍔?鈥斺€?绉婚櫎銆岄」鐩绠椼€?銆屽洖娆惧垎閰嶆槑缁嗐€嶄袱涓潪鏍稿績妯垏鍔熻兘
- **feat(audit)**:`OperationLog` 琛?6 瀛楁 `userAgent / requestId / method / path / status / errorMessage` + 閰嶅绱㈠紩 + 500 瀛楃 `userAgent` CHECK 绾︽潫
- **feat(api)**:`GET /api/operation-logs` 澧?6 瀛楁涓?`ip(contains) / status` 杩囨护;鏂板璇︽儏鎺ュ彛 `GET /api/operation-logs/[id]` 鍚?entity 鍚嶇О best-effort 鍙嶆煡
- **feat(ui)**:`/admin/operation-logs` 閲嶅啓 鈥?鐘舵€?/ IP 鍒椼€? 妗ｅ揩閫熸椂闂村尯闂淬€佺郴缁熺敤鎴风传鑹插窘鏍囥€佸姩浣滀腑鏂囨爣绛俱€丆SV 瀵煎嚭(甯?BOM),琛岀偣鍑绘墦寮€鎶藉眽
- **feat(contract)**:鍚堝悓鐘舵€佹満鑷姩杞崲钀藉湴 鈥?`tryAutoExecuteContract` / `tryAutoCompleteContract` / `tryAutoExpireContract` 涓変釜閽╁瓙 + `runContractExpiryJob` 姣忔棩 01:00 鎵繃鏈熷悎鍚?
- **feat(schema)**:`User.isSystem Boolean @default(false)` + 杩佺Щ鍒涘缓 `system` 鍗犱綅鐢ㄦ埛(涓嶅彲鐧诲綍)

## 鍘嗗彶閲岀▼纰?

- **v0.8.0(2026-07-03)**: 鎶ヨ〃涓績 PDF 5 瀛楁瀵归綈 + Excel 澶?sheet + 绉婚櫎鑷姩鐢熸垚 (cron 鍒犱簡, 璧版墜鍔? + 鏂囦欢鍚嶆椂闂存埑 (YYYY-MM-DD_HHMM)
- **v0.6.0(2026-06-29)**:cron 闈欓粯澶辫触 9 涓湀浜嬫晠澶嶇洏 (242 涓悎鍚?269 涓囧簲鏀舵仮澶? + reopen API + force 鏃佽矾 + cron-healthcheck 鑷 + 寮哄叧 7/3/1 閱掔洰鏂囨 + postmortem reopen vs force 涓氬姟閫夋嫨鎸囧崡 + Timeline icon 瀵圭О + serviceTypeLabel helper + by-region Tooltip
- **v0.5.1+(2026-06-29)**:缁熻鍖洪棿鏈堝害/瀛ｅ害/骞村害鍒囨崲 + dashboard 瀹㈡埛缁熻鍙ｅ緞閲嶅懡鍚?+ system actor seed + 鍚堝悓 owner 榛樿鍊?+ 璇佷功椤?bug + 杩佺Щ婕傜Щ鎭㈠ + AI 鍥㈤槦閰嶇疆 + 娓呯悊 18 涓鍎胯剼鏈?lib 鏂囦欢
- **v0.5.1(2026-06-29)**:Excel 瀵煎嚭鏂囦欢鍚嶅浗闄呭寲 + 鍚堝悓閫夋嫨鍣ㄦ樉绀哄悎鍚屾€婚
- **v0.5.0(2026-06-29)**:瀹㈡埛鐘舵€佹満涓嬬嚎(纭垹, BREAKING; 5 鎬?4 瑙勫垯/鎾ら攢妯箙 鍏ㄥ垹; Customer 琛ㄦ棤 status)
- **v0.3.0(2026-06-23/24)**:浼佷笟璧勪骇搴撲笅绾?+ 缁熻鍒嗘瀽 round-2 鏀跺熬 + 鍚堝悓 7鈫? 鐘舵€佹満 + 椤圭洰/宸ヤ綔娴佹ā鍧楀垹闄?
- **v0.2.0(2026-06-22)**:鍚堝悓/椤圭洰鏀剁揣 + 涓氬姟绾寲
- **v0.1.0(2026-06-11)**:涓婄嚎鍓嶆竻鐞?鈥?娓呯┖ 136 涓?lint warnings,鐧诲綍椤?+ 椤堕儴瀵艰埅鍝佺墝鍖?缁熶竴浠撳簱 `core.autocrlf=false`
- **v0.1.0-rc.1**:MinIO 鎺ュ叆(presign upload/download + Attachment 琛?+ CORS);Docker 鍚堝苟涓哄崟 image;鍚堝悓/鍙戠エ涓婁紶/棰勮/涓嬭浇/鍒犻櫎绔埌绔墦閫?
- **P3**:RLS 绛栫暐 + 澶囦唤鑴氭湰 + Vercel Cron(鍘熼€氱煡涓夐€氶亾宸插悎骞跺埌绔欏唴淇?
- **P2**:棰嗗煙浜嬩欢鎬荤嚎 + 4 涓畾鏃朵换鍔?+ 缁熻鍒嗘瀽 + xlsx 瀵煎嚭 + 杞垹闄?
- **P1**:浜斿ぇ妯″潡 CRUD + 16 鏉¤法妯″潡鏍￠獙 + 27/27 e2e
- **P0**:椤圭洰鑴氭墜鏋?+ 鐧诲綍 + 瀛楀吀绉嶅瓙 + 4 瑙掕壊鏉冮檺

## 閮ㄧ讲

### 鐜鍙橀噺

```env
DATABASE_URL="postgresql://qitai:qitai_pass@localhost:5432/qt_biz?schema=public"
NEXTAUTH_SECRET="..."          # 鑷冲皯 32 瀛楃
NEXTAUTH_URL="https://app.example.com"
APP_ENC_KEY_HEX="..."          # 32 瀛楄妭 hex = 64 瀛楃(AES-256-GCM 鍔犲瘑鏁忔劅瀛楁)
APP_PUBLIC_URL="https://app.example.com"
APP_LOCALE="zh-CN"
CRON_SECRET="..."              # Vercel Cron 閴存潈
FORCE_HTTPS="true"             # 鐢熶骇寮€鍚?Secure Cookie
```

璇﹁ [.env.example](.env.example)銆?

### 鐢熶骇閮ㄧ讲椤哄簭

```bash
npx prisma migrate deploy
npm run seed-roles
npm run seed-dicts
npm run create-admin -- --employeeNo <鐪熷疄宸ュ彿> --name <鐪熷悕> --email <鍏徃閭> --password '<寮哄瘑鐮?'
npm run seed       # 姝ゆ椂鎵惧埌 ADMIN, 鍐欏叆宸ヤ綔娴佹ā鏉?
```

**鐢熶骇瀵嗙爜**:`create-admin` 寮哄埗 鈮?8 瀛楃,鐢熶骇璇风敤瀵嗙爜绠＄悊鍣ㄧ敓鎴愮殑闅忔満涓层€?

### 闃块噷浜?ECS 鍗曚富鏈洪儴缃?

璇﹁ [docs/闃块噷浜?ECS 鍗曚富鏈洪儴缃叉柟妗?鈥?qt-biz v0.1.0.md](docs/%E9%98%BF%E9%87%8C%E4%BA%91%20ECS%20%E5%8D%95%E4%B8%BB%E6%9C%BA%E9%83%A8%E7%BD%B2%E6%96%B9%E6%A1%88%20%E2%80%94%20qt-biz%20v0.1.0.md) 鍜?[ops/](ops/)銆?

### 澶囦唤涓庡畾鏃朵换鍔?

- **鏈湴 cron**:`bash scripts/prod/backup.sh` + crontab `0 2 * * *`
- **Vercel Cron**:`vercel.json` 宸查厤 `POST /api/jobs/run-all` 姣忔棩 01:00 UTC
- **Cron Secret**:Vercel Cron 鑷姩娉ㄥ叆 `Authorization: Bearer <CRON_SECRET>` 閴存潈

## 鐩稿叧鏂囨。

| 鏂囨。 | 鐢ㄩ€?|
|---|---|
| [docs/DESIGN-v3.md](docs/DESIGN-v3.md) | 瀹屾暣璁捐(v3,鐗堟湰鐭╅樀閽夌増) |
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | 鐢ㄦ埛鎵嬪唽(瀵瑰簲 v0.2.0,v0.3.0 椤圭洰妯″潡宸蹭笅绾? |
| [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md) | 椤圭洰鎬荤粨 |
| [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) | 涓婄嚎鍓嶄唬鐮佸鏌?|
| [docs/P2_REVIEW.md](docs/P2_REVIEW.md) | P2 璇勫 + 缁熻鍒嗘瀽 round-2 淇 |
| [docs/P3_REVIEW.md](docs/P3_REVIEW.md) | P3 璇勫 |
| [docs/RLS.md](docs/RLS.md) | RLS 绛栫暐 |
| [docs/PLAYWRIGHT_E2E_REPORT.md](docs/PLAYWRIGHT_E2E_REPORT.md) | Playwright E2E 鎶ュ憡 |
| [docs/ops/瀛楀吀缁存姢璇存槑.md](docs/ops/%E5%AD%97%E5%85%B8%E7%BB%B4%E6%8A%A4%E8%AF%B4%E6%98%8E.md) | 鏁版嵁瀛楀吀缁存姢 |
| [docs/specs/dict-redesign.md](docs/specs/dict-redesign.md) | 瀛楀吀閲嶈璁?spec |
| [ops/README.md](ops/README.md) | 杩愮淮鑴氭湰璇存槑 |
| [scripts/README.md](scripts/README.md) | 鑴氭湰璇存槑 |

## 瀹夊叏

- **涓嶈**鎻愪氦 `.env`銆乣docker-data/`銆乣backups/`銆乣docs/*閮ㄧ讲璁板綍*.md`
- 涓婁紶/涓嬭浇璧?Next.js 浠ｇ悊,MinIO 鐣欏湪 `:9000` 鍐呯綉,涓嶅叕缃戞毚闇?
- `npm run seed` 浠呯郴缁熺鐞嗘暟鎹?鐢熶骇绉嶅瓙鍦ㄥ共鍑€鐜鎵嬪姩璺?涓嶉殢渚嬭鏇存柊璺?
- dev 榛樿璐﹀彿(`minioadmin/minioadmin`銆乣postgres/postgres`)浠呮湰鍦扮敤,鐢熶骇鍓嶅繀椤昏疆鎹?
