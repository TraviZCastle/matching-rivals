# 词局 Matching Rivals — 产品与实施计划

## 0. 当前状态

- 本地 Demo 已于 2026-08-20 验收通过。
- Light / Dark Mode 均已统一为藏青与深蓝视觉体系。
- 生产 Beta 基础阶段进行中。
- 已新增 Supabase 初始迁移：账号归属、房间、玩家、题集、答题记录、RLS、私有 Realtime Broadcast 和服务器计时 RPC。
- 已迁移为标准 Next.js 工程，可由 GitHub 连接 Vercel 自动部署。
- 已发布 GitHub 与 Vercel Production，并连接 `main` 分支自动部署。
- 下一接入点：创建 Supabase 项目并应用迁移，然后把前端的 `localStorage` / `BroadcastChannel` 仓库替换为 Supabase Auth、RPC 与 Realtime。

## 1. 项目目标

两名玩家进入同一房间，在统一倒计时后开始中英文配对竞速。每名玩家独立完成同一组题目，系统记录服务器用时、错配次数和最终名次。

首个版本的核心价值是：“不需要学习说明，几秒内可以开局，比赛结果明确可信。”

## 2. MVP 范围

### 本地 Demo

- 输入昵称后创建六位房间口令。
- 第二个浏览器标签页通过口令加入。
- 双方准备、3 秒倒计时、统一开始。
- 点击中文和英文完成配对，错配可视化反馈。
- 同步对手进度，记录用时和错配数。
- 双方完成后显示排名，支持再来一局。
- 本地 Demo 通过 `localStorage` + `BroadcastChannel` 模拟实时后端，不需要密钥。

### 生产 Beta

- Next.js 部署到 Vercel。
- Supabase Auth 提供匿名登录，后续可绑定邮箱。
- Supabase Postgres 持久化房间、玩家、题目和成绩。
- Supabase Realtime Broadcast 发送准备、开始、进度和完成事件。
- Supabase Presence 仅用于低频在线/离线状态。
- Postgres RPC 原子处理加入、开局、提交和完成。

## 3. 非目标

- 首版不做公开排行榜、好友系统、聊天和赛季。
- 首版不做拖拽配对，优先使用适合手机的两次点击。
- 首版不依赖 AI 生成题目。
- 本地 Demo 不实现真实账号、RLS 或多设备网络通信。

## 4. 核心游戏规则

1. 两名玩家使用同一份题目集，选项显示顺序可以不同。
2. 双方都准备后进入 3 秒倒计时。
3. 正式成绩使用 `finished_at - started_at`；页面计时器仅用于显示。
4. 先选择一个中文词，再选择一个英文词。
5. 配对正确：两项锁定并使进度 +1。
6. 配对错误：错配计数 +1，整块输入锁定 0.5 秒，错配词块在锁定期间保持错误样式，然后可重选。
7. 排名先比完成用时；用时精确相同时比错配次数；仍相同则平局。
8. Demo 每局包含 6 对词，生产版可配置。

## 5. 页面与状态流程

```text
首页/输入昵称
  ├─ 创建房间 → 等待对手
  └─ 输入口令 → 加入房间
                         ↓
                    双方准备
                         ↓
                     3 秒倒计时
                         ↓
                       比赛中
                         ↓
                一方完成/等待对手
                         ↓
                    结果与再来一局
```

房间状态：`waiting` → `countdown` → `playing` → `finished`。

## 6. 本地 Demo 数据结构

```ts
type Room = {
  code: string
  status: "waiting" | "countdown" | "playing" | "finished"
  hostId: string
  createdAt: number
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

房间快照写入 `localStorage`，并通过 `BroadcastChannel` 通知其他标签页重读。每个标签页的玩家身份保存在 `sessionStorage`。

## 7. 生产数据表

- `profiles`：昵称、账号类型。
- `rooms`：口令、状态、局数、开始/结束时间。
- `room_players`：房间成员、准备、进度、错配和完成时间。
- `question_sets`：题集名称与版本。
- `question_pairs`：中文、英文和题集关联。
- `attempts`：必要时记录提交事件，用于审计和反作弊。

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
- Supabase secret key 仅存在 Vercel 服务端环境变量中。
- 对创建/加入房间和匿名登录实施限流。

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

## 12. Demo 验收标准

- 开发构建和生产构建成功。
- 同一浏览器的两个独立标签页可创建并加入同一房间。
- 双方名称、准备状态和进度能在 500ms 内同步。
- 只有双方都准备时才开始倒计时。
- 错误配对不会增加进度，会增加错配数。
- 6 对全部完成后锁定用时，不随页面继续运行而变化。
- 双方完成后结果页在两个标签页中一致。
- 在 375px 宽度下可完整操作，关键文本不截断。
- 按钮可使用键盘聚焦和激活，并有明显的焦点状态。
