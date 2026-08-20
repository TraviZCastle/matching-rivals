# 词局 · Matching Rivals

一个双人中英文词汇配对竞速项目。Demo 已验收，当前工程已迁移为标准 Next.js，并开始接入 Vercel + Supabase 生产 Beta。

## 当前能力

- 六位房间口令。
- 进入大厅时自动生成可编辑的英文昵称。
- 两个独立浏览器标签页同步。
- 双方准备和 3 秒倒计时。
- 6 组中英文点击配对。
- 错配计数、对手进度和成绩排名。
- 完成后再来一局。
- 桌面和移动端响应式界面，并支持 Light / Dark Mode。
- 错配后锁定输入并保持错误样式 0.5 秒。

## 本地启动

需要 Node.js 22.13 或更高版本，以及 pnpm。

```bash
pnpm install
pnpm run dev
```

打开终端显示的本地地址，通常是 `http://localhost:3000/`。

## 试玩步骤

1. 在第一个标签页输入昵称，点击“Create a new match”。
2. 复制页面中的六位口令。
3. 新建一个空白标签页（不要复制当前标签页），再次打开本地地址。
4. 输入第二个昵称和房间口令，点击“Join”。
5. 两个标签页分别点击“I'm ready”。
6. 倒计时后，先点击左侧中文，再点击右侧英文。

Demo 使用 `localStorage` 保存房间快照，并通过 `BroadcastChannel` 同步标签页。它只适合本地演示，不是生产级后端。

仓库内已包含 Supabase 初始数据库迁移和前端适配层；在生产环境变量配置完成前，页面继续使用本地 Demo 数据层，方便独立验收界面与交互。

当前 Demo 没有接入外部词典或词典 API；题目是代码内维护的 6 组人工示例词。生产版需要单独确定授权词源、词义粒度和题库审核流程。

## 检查命令

```bash
pnpm run build
pnpm run lint
pnpm test
```

## 生产版路线

生产 Beta 将使用 Vercel + Supabase：

- Supabase Auth：匿名登录和稳定的玩家 ID。
- Postgres：房间、玩家、题库和成绩。
- Realtime Broadcast / Presence：事件和在线状态。
- Postgres RPC：原子加入、开局、答题校验和服务器计时。
- RLS：限制玩家只能访问自己参加的房间。

完整产品规则、数据模型和验收标准见 [`PLAN.md`](./PLAN.md)。
