# 词局 Matching Rivals — 产品与实施计划

## 0. 当前状态

- 本地 Demo 已于 2026-08-20 验收通过。
- Light / Dark Mode 均已统一为藏青与深蓝视觉体系。
- 生产 Beta 已接入，完整双用户本地及正式域名联机验收均已通过。
- 已新增 Supabase 初始迁移：账号归属、房间、玩家、题集、答题记录、RLS、私有 Realtime Broadcast 和服务器计时 RPC。
- 已迁移为标准 Next.js 工程，可由 GitHub 连接 Vercel 自动部署。
- 已发布 GitHub 与 Vercel Production，并连接 `main` 分支自动部署。
- 已创建 Supabase 项目、应用迁移、启用匿名登录，并向 Vercel Production、Preview 与 Development 写入浏览器公开环境变量。
- 前端已从本地 `localStorage` / `BroadcastChannel` 仓库切换为 Supabase Auth、RPC、受 RLS 保护的表读取与私有 Realtime Broadcast。
- 下一阶段已完成本地与 Production 验收：5 分钟房间有效期、单人练习、五类 500 词题库、随机 6 题、分难度 Solo 前十，以及首位完成即结束比赛。
- Supabase 迁移 004–006 已应用，功能代码已直接推送 `main` 并由 Vercel 部署；Production 已实测创建 TEM-8 Solo 并正确返回 6 题。

## 1. 项目目标

两名玩家进入同一房间，在统一倒计时后开始中英文配对竞速。每名玩家独立完成同一组题目，系统记录服务器用时、错配次数和最终名次。

首个版本的核心价值是：“不需要学习说明，几秒内可以开局，比赛结果明确可信。”

## 2. MVP 范围

### 已验收 Demo

- 输入昵称后创建六位房间口令。
- 第二个浏览器标签页通过口令加入。
- 双方准备、3 秒倒计时、统一开始。
- 点击中文和英文完成配对，错配可视化反馈。
- 同步对手进度，记录用时和错配数。
- 首位完成后显示胜者与未完成者 `DNF`，支持再来一局。
- Demo 阶段曾通过 `localStorage` + `BroadcastChannel` 模拟实时后端；生产分支现已替换为 Supabase。

### 生产 Beta

- Next.js 部署到 Vercel。
- Supabase Auth 提供匿名登录，后续可绑定邮箱。
- Supabase Postgres 持久化房间、玩家、题目和成绩。
- Supabase Realtime Broadcast 发送准备、开始、进度和完成事件。
- Supabase Presence 仅用于低频在线/离线状态。
- Postgres RPC 原子处理加入、开局、提交和完成。

### 下一阶段

- 房间有效期为 5 分钟；再来一局会重新获得 5 分钟。
- 支持不创建对战口令的单人练习。
- 大厅可选择 CET-4、CET-6、TEM-8、IELTS 或 TOEFL。
- 每类题库包含 500 个代表性词对，五类之间不重复；每局随机抽取 6 对。
- Solo 按难度分别保留前十名完赛时间，前三名特殊显示。
- 双人比赛由第一名完成全部配对的玩家立即终止，另一名玩家记为 `DNF`。

## 3. 非目标

- 首版仅做按难度划分的 Solo 前十，不做好友榜、赛季、聊天或复杂排行榜。
- 首版不做拖拽配对，优先使用适合手机的两次点击。
- 首版不依赖 AI 生成题目。
- 首版不要求注册式账号；使用 Supabase 匿名身份。

## 4. 核心游戏规则

1. 玩家创建时选择双人竞速或单人练习，并选择一份题集。
2. 双人模式的两名玩家使用同一份题目集，选项显示顺序可以不同；双方都准备后进入 3 秒倒计时。
3. 单人模式创建后直接开始，不显示口令、准备流程和对手进度。
4. 房间自创建起有效 5 分钟，超时后不能加入、准备或继续答题；再来一局会重置期限。
5. 正式成绩使用 `finished_at - started_at`；页面计时器仅用于显示。
6. 先选择一个中文词，再选择一个英文词。
7. 配对正确：两项锁定并使进度 +1。
8. 配对错误：错配计数 +1，整块输入锁定 0.5 秒，错配词块在锁定期间保持错误样式，然后可重选。
9. 双人竞速中第一名完成全部配对时立即结束；胜者记录完成用时，另一名玩家显示 `DNF`。
10. 每局从所选 500 词题库随机抽取 6 对；双人双方使用相同 6 对，排列顺序可不同。
11. Solo 完成后按用时、错配数和完成时间排序，每个难度只保留前十。

## 5. 页面与状态流程

```text
首页/输入昵称与选择题集
  ├─ 单人练习 → 直接开始 ─────────────┐
  ├─ 创建竞速房间 → 等待对手          │
  └─ 输入口令 → 加入竞速房间           │
                         ↓
                  双方准备
                         ↓
                     3 秒倒计时
                         ↓
                       游戏中
                         ↓
             单人完成 / 竞速首位完成
                         ↓
               结果（未完成者 DNF）
```

房间状态：竞速为 `waiting` → `countdown` → `playing` → `finished`，练习为 `playing` → `finished`；两种模式都可能在完成前进入 `expired`。

## 6. 前端房间视图

```ts
type Room = {
  code: string
  mode: "race" | "practice"
  questionSetId: string
  status: "waiting" | "countdown" | "playing" | "finished" | "expired"
  hostId: string
  createdAt: number
  expiresAt: number
  countdownAt?: number
  startedAt?: number
  round: number
  players: Array<{
    id: string
    name: string
    ready: boolean
    progress: number
    mistakes: number
    matchedIds: string[]
    finishedAt?: number
  }>
}
```

房间权威快照保存在 Postgres。客户端通过私有 Realtime Broadcast 收到变化通知后重新读取；每个标签页的匿名 Auth 会话与当前房间 ID 保存在 `sessionStorage`，因此同一浏览器的两个标签页也可作为两个玩家验收。

## 7. 生产数据表

- `profiles`：昵称、账号类型。
- `rooms`：模式、题集、口令、状态、局数、创建/到期/开始/结束时间。
- `room_players`：房间成员、准备、进度、错配和完成时间。
- `question_sets`：题集名称与版本。
- `question_pairs`：中文、英文和题集关联。
- `attempts`：必要时记录提交事件，用于审计和反作弊。
- `solo_records`：各难度 Solo 前十的昵称、用时、错配数和完成时间。

## 8. 生产实时事件

- `player_joined`
- `ready_changed`
- `countdown_started`
- `game_started`
- `progress_changed`
- `player_finished`
- `game_finished`
- `rematch_started`

客户端事件不得直接决定成绩，仅作为界面刷新信号。最终状态以 Postgres 为准。

## 9. 安全与公平性

- 全部业务表启用 RLS。
- 只有房间成员能读取房间和私有 Realtime Channel。
- 只能修改自己允许的玩家状态。
- 开局、答题校验与完成使用 Postgres RPC。
- 服务端使用数据库时间，不信任客户端提交的用时。
- 浏览器只使用 Supabase publishable key；当前不配置也不暴露 service-role key。
- Supabase Auth 自带基础速率限制；正式公开推广前补充 CAPTCHA、房间清理策略和业务级创建/加入限流。

## 10. 视觉方向

- 感觉：语言训练工具 + 快节奏竞技场。
- 色彩：深蓝黑、暖白、高亮柠檬绿，用珊瑚红表示错误。
- 字体：清晰的无衬线字体，数字计时器使用等宽特征。
- 交互：大按钮、明确选中态、不依赖 hover，移动端可单手点击。

## 11. 实施里程碑

1. 可识别的大厅界面和移动端布局。
2. 本地房间、双标签同步和准备流程。
3. 倒计时、配对核心玩法、进度和成绩。
4. 结果页、再来一局和异常状态。
5. 构建检查和两标签页端到端验收。
6. 替换本地同步层为 Supabase，部署 Vercel Beta。
7. 本地验证 5 分钟期限、单人练习、500 词题库、随机 6 题、Solo 榜和首位完成即结束。
8. 已应用下一阶段 Supabase 迁移、推送 `main` 并验证 Vercel Production。

## 12. Demo 验收标准

- 开发构建和生产构建成功。
- 同一浏览器的两个独立标签页可创建并加入同一房间。
- 双方名称、准备状态和进度能在 500ms 内同步。
- 只有双方都准备时才开始倒计时。
- 错误配对不会增加进度，会增加错配数。
- 单人练习无需第二个标签页即可完成并显示成绩。
- 大厅可切换五类题集，并且局内题目与选择一致。
- 五类题集各有 500 对，跨题集无重复，每局只出现随机抽取的 6 对。
- Solo 榜按难度独立保留前十，前三名具有不同视觉层级。
- 单/双人切换时表单模块顶部位置保持一致，不发生布局跳动。
- 房间创建后显示 5:00 有效期，过期后不可继续操作。
- 竞速任意一方完成 6 对后立即锁定用时，两个标签页同步显示同一胜者，未完成者为 `DNF`。
- 在 375px 宽度下可完整操作，关键文本不截断。
- 按钮可使用键盘聚焦和激活，并有明显的焦点状态。
