# Milky 插件设计文档（SDK + Bot Runtime）

## 目标

- **业务侧最省心**：Bot 默认直接暴露所有 Milky API endpoint 方法（`bot.get_login_info()`），不需要 `bot.api.call(...)` 这种二级入口。
- **职责分离**：API 调用与 Bot 生命周期/状态管理明确分层；“控制面”能力通过 `bot.$control` 访问，不与 endpoint 方法混在同一层。
- **类型强约束**：endpoint 入参/出参类型自动随 `@saltify/milky-types` 与 OpenAPI 更新，无需手写。
- **性能与体积**：endpoint 方法只创建一次（共享原型），实例只携带最小状态（`$raw` 核心），避免每实例大量函数分配。
- **单一事件通道**：仅支持 SSE 事件流（不设计/不实现 WS），避免配置与分支复杂度。

## 目录结构（按领域归属）

- `chatbots/milky/src/api/`：Milky API SDK（纯调用层）
  - `definitions.generated.ts`：生成的 endpoint 列表（含 input/output struct 名称）
  - `definitions.ts`：对外 re-export（endpoint 类型）
  - `endpoints.source.ts`：**macro 入口**（构建期内联 endpoint 列表与 struct index）
  - `prototype.ts`：endpoint 方法共享原型（一次性定义，实例复用）
  - `request.ts`：最底层 HTTP 请求（处理鉴权、Milky envelope、Zod 校验）
  - `tool.ts`：常用工具（session/builder）
  - `client.ts`：组装 `$raw` 与 schema 解析，产出 `MilkyApi` 实例（并注入 `$tool`）
  - `types.ts`：SDK 类型（`MilkyApi*`、`Result`、schema 推导等）
  - `index.ts`：对外出口（`createMilkyApi` 等）
- `chatbots/milky/src/bot/`：Bot（把 SDK 注入到 Bot 实例 + 事件连接）
  - `api.ts`：`AbstractBot`（只负责注入 `this.$raw/$tool`，并通过原型链提供 endpoint 方法）
  - `index.ts`：`MilkyBot`（事件流连接、状态维护、`$control` 面）
- `chatbots/milky/src/runtime/`：运行时编排（多 Bot 管理 + RPC/SSE）
  - `runtime.ts`：`MilkyRuntime`（插件运行时入口：repo/manager/sse 的组合）
  - `bot-manager.ts`：`MilkyBotManager`（Bot 实例管理与状态落库）
  - `bot-registry.ts`：bot 配置与状态持久化（含 token 加密）
  - `rpc.ts`：`MilkyBotRpc`（UI/RPC 调用入口）
  - `sse.ts`：SSE bridge（推送快照/游标）
  - `index.ts`：runtime 对外出口
- `chatbots/milky/src/`（其它横切模块）
  - `milky.ts`：插件入口（注册 UI/RPC/SSE 扩展）
  - `extensions.ts`：扩展注册
  - `shared/status.ts`：bot 状态模型（跨 bot/runtime 共用）
  - `shared/utils.ts`：跨模块工具函数（baseUrl 校验、token mask）
  - `config.ts`、`events/*`、`ui/*`：配置、事件与 UI

## API 设计

### 1) `MilkyApi` 的形状

- endpoint 方法：`api.get_login_info()` / `api.send_group_message(payload)` …
- 扩展能力统一收敛到 `$` 前缀命名空间：
  - `api.$raw.call(endpoint, payload?)`：动态 endpoint 或需要字符串调用时的兜底
  - `api.$raw.request(api, payload, schemas?)`：最低层 HTTP（包含 envelope + 可选 zod 校验）
  - `api.$tool.*`：常用工具（session/builder 等）

这样把“日常使用的 endpoint 方法”和“内部/兜底能力”分层，避免 API 表面被工具方法污染。

常用工具示例：

- `const session = bot.$tool.createGroupSession(123)`
- `await session.send('hello')`
- `await session.reply(456, 'reply')`
- `await session.delete()` / `await session.delete(456)`
- `const sendmsg = bot.$tool.createGroupMessageBuilder(123); await sendmsg('hi')`

### 2) endpoint 方法的性能实现（共享原型）

- `src/api/prototype.ts` 通过 macro 内联的 endpoint 列表，在模块初始化时把所有 endpoint 方法定义到 `MILKY_API_PROTO` 上。
- `createMilkyApi()` 用 `Object.create(MILKY_API_PROTO)` 创建实例，实例补齐：
  - `api.$raw`：`call/request`
  - `api.$tool`：session/builder 等工具
- 结果：endpoint 函数不会按实例重复创建；每个 Bot/API 实例只保留最小状态。

### 3) schema 推导与校验

- endpoint -> `{ inputStruct, outputStruct }` 的索引由 `endpoints.source.ts`（macro）构建期内联。
- `client.ts` 在第一次命中某个 endpoint 时缓存对应 `SchemaPair`（input/output Zod schema），后续直接复用。

## Bot 设计

### 1) Bot 默认暴露 endpoint 方法

- `AbstractBot` 构造时只设置 `this.$raw = createMilkyRawApi(...)`，并注入 `this.$tool`。
- 并将 `AbstractBot.prototype` 的原型指向 `MILKY_API_PROTO`，从而每个 Bot 实例天然拥有 endpoint 方法（无需 `Object.assign` 拷贝）。

### 2) 控制面与状态面：`bot.$control`

Bot 的生命周期控制与状态读取通过 `bot.$control` 暴露：

- `bot.$control.info`：Bot 元信息（`instanceId/baseUrl`）
- `bot.$control.start()` / `bot.$control.stop()`：启动/停止事件连接
- `bot.$control.getStatusSnapshot()`：读取状态快照

这样可以保持 `bot.xxx()` 命名空间主要留给 API endpoint（避免与控制方法冲突，也更易 discover）。

## 性能导向设计原则

### 1) “高频路径”只做常数级工作

- **endpoint 方法**：通过 macro 内联 endpoint 列表并挂到共享原型（`src/api/prototype.ts`），避免“每实例 bind/forEach 生成函数”的启动成本与内存占用。
- **事件分发**：`dispatchMilkyEvent` 仅做一次 `selfId` 归一化，并为每条事件最多分配 1 个 session 对象；只有 `message_receive` 会额外分配 `message` 特化 session（`src/events/dispatcher.ts`）。

### 2) 类型用于“编译期穷尽检查”，而不是运行时反射

- `MilkyEventMap` 由 `MilkyEvent['event_type']` 映射生成：保证每个 `event_type` 在本地都有**同名**事件通道；上游新增事件时，编译期会强制你补齐（`src/events/events.types.ts`）。
- 分发使用 `switch` + `assertNever`：避免运行时通过 `events[event_type]` 做动态索引，同时提供穷尽性校验（`src/events/dispatcher.ts`）。

### 3) Session 保持“最小必要形状”，工具按需构造

- session 只携带业务 handler 必需的稳定字段：`bot/event/meta/selfId`，不在高频事件里塞入会产生闭包/分配的 helper。
- 常用便捷能力集中在 `bot.$tool`：业务代码需要时再创建会话工具（如 `createGroupSession`），避免每条事件都构造大量对象（`src/api/tool.ts`）。

### 4) 单一事件通道减少分支与状态面复杂度

- 仅支持 SSE：Bot 侧连接与恢复逻辑只围绕 SSE 设计，不引入 WS 的额外状态机与配置面（`src/bot/index.ts`）。

## 生成与更新

- `pnpm -C chatbots/milky gen:api`：生成 `src/api/definitions.generated.ts`
- （可选）`pnpm -C chatbots/milky update:openapi`：拉取最新 OpenAPI 并刷新 definitions
