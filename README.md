# 词局 · Matching Rivals

一个支持双人竞速与单人练习的中英文词汇配对项目。线上 Production 仍保持已验收版本；下一阶段功能保存在独立开发分支，尚未合并或部署到 Production。

## 在线地址

- Production: [matching-rivals.vercel.app](https://matching-rivals.vercel.app)
- Source: [github.com/TraviZCastle/matching-rivals](https://github.com/TraviZCastle/matching-rivals)

`main` 分支已连接 Vercel，后续 Git push 会自动触发 Production 部署。

## 线上 Production 能力

- 六位房间口令。
- 进入大厅时自动生成可编辑的英文昵称。
- 两个独立浏览器标签页或设备实时同步。
- 双方准备和 3 秒倒计时。
- 6 组中英文点击配对。
- 错配计数、对手进度和成绩排名。
- 完成后再来一局。
- 桌面和移动端响应式界面，并支持 Light / Dark Mode。
- 错配后锁定输入并保持错误样式 0.5 秒。

## 本地测试中的下一阶段

- 房间从创建或再来一局开始计算，有效期 5 分钟。
- 新增单人练习模式，无需房间口令或第二名玩家。
- 可选择 CET-4、CET-6、TEM-8、IELTS、TOEFL 五类题集。
- 双人竞速在第一名玩家完成全部配对时立即结束；未完成玩家在结果页显示 `DNF`。
- 使用浏览器本地测试后端，不依赖或修改远程 Supabase 数据。

## 本地启动

需要 Node.js 22.13 或更高版本及 pnpm。

```bash
pnpm install
cp .env.example .env.local
pnpm run dev
```

验证当前线上后端时，在 `.env.local` 中填写 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。

只验证本地下一阶段功能时，新建不提交的 `.env.development.local`：

```bash
NEXT_PUBLIC_GAME_BACKEND=local
```

该模式使用 `localStorage` 保存房间快照、`sessionStorage` 区分标签页玩家，并通过 `BroadcastChannel` 同步两个标签页；不需要本地 Supabase、Docker 或远程数据库写入。

打开终端显示的本地地址，通常是 `http://localhost:3000/`。

## 试玩步骤

1. 在第一个标签页输入昵称，选择题集，点击“Create a rival match”。
2. 复制页面中的六位口令。
3. 新建一个空白标签页（不要复制当前标签页），再次打开本地地址。
4. 输入第二个昵称和房间口令，点击“Join”。
5. 两个标签页分别点击“I'm ready”。
6. 倒计时后，先点击左侧中文，再点击右侧英文。

单人练习可在大厅选择 “Solo practice” 后直接开始。双人竞速中任意一方完成 6 对词后，本局立即结束，另一方显示 `DNF`。

生产 Beta 使用 Supabase 匿名 Auth 建立玩家身份，通过 Postgres RPC 校验房间与答题，并使用私有 Realtime Broadcast 通知双方刷新权威状态。浏览器仅保存当前标签页的匿名会话和房间 ID；比赛时间以数据库时间为准。

当前没有接入外部词典或词典 API。五个题集各含 6 组人工整理的演示词，仅用于验证题集切换和玩法，不代表对应考试的官方或完整词表。生产版仍需单独确定授权词源、词义粒度和题库审核流程。

## 检查命令

```bash
pnpm run build
pnpm run lint
pnpm test
```

## 生产版路线

生产 Beta 使用 Vercel + Supabase：

- Supabase Auth：匿名登录和稳定的玩家 ID。
- Postgres：房间、玩家、题库和成绩。
- Realtime Broadcast / Presence：事件和在线状态。
- Postgres RPC：原子加入、开局、答题校验和服务器计时。
- RLS：限制玩家只能访问自己参加的房间。

完整产品规则、数据模型和验收标准见 [`PLAN.md`](./PLAN.md)。
