# Bot-Layer 设计文档（Parts + Outbound）

## 目标

- 用 `Part[]` 描述跨平台消息内容（接收端保留完整表达力：平台原生能力永远可用，优先通过 `msg.bot` 访问）
- 发送端优先“友善可用”：`reply()` 尽可能成功发送，并在必要时自动拆成多条消息（行为必须通过 JSDoc 明确告知调用方）
- 显式发送接口只提供原子能力（`sendText/sendImage/sendFile/upload*`）；复杂编排交由下游决定
- adapter 只实现原子能力（`send/uploadMedia/render`），bot-layer 负责规范化、校验与拆分策略

## 目录结构

- `chatbots/bot-layer/src/parts/`
  - `normalize.ts`：`PartInput -> Part[]` 的规范化/扁平化（合并相邻 text）
  - `dsl.ts`：构建 Part 的便捷函数（含 `imageData/fileData`）
  - `jsx-runtime.ts`：TSX/JSX 运行时（把 JSX 转成 `Part | Part[]`）
- `chatbots/bot-layer/src/outbound/`
  - `plan.ts`：将 `Part[]` 规划成“发送操作序列”（`reply()` 使用它做稳定拆分）
- `chatbots/bot-layer/src/adapter/`
  - adapter 接口 + 注册表 + `createReply/createSendHelpers` 发送能力

## Parts 设计语言

### 1) 规范化输入

bot-layer 的 Outbound 入口（`reply/sendText` 等）支持：

- `string`
- `Part`
- `Part[]`
- 任意嵌套数组/可迭代结构（便于 JSX Fragment / 条件拼接展开）

最终都会归一为 `Part[]`（相邻 text 会自动合并；`styled.children` 内也会合并相邻 text）。

### 2) DSL

`parts/dsl.ts` 提供：

- `text/mention/link/codeblock/bold/italic/strike/code`
- `image(url, alt?)`、`file(url, name?, mime?)`
- `imageData(data, opts?)`、`fileData(data, opts?)`：用于“先上传再发送 / 或直接二进制发送”的场景

## Outbound：`reply()` 友善拆分规则（可预测、按顺序）

### 1) `reply()` 的定位

`reply(content)` 是“尽量把你写的内容发出去”的便利层：

- 允许混合输入（多段文本、多张图片、文件夹杂文本等）
- 可能会拆成多条消息发送（按输入顺序）
- 对文本类 Part 做平台降级（例如 plain 平台将 styled/link/codeblock 退化为纯文本）
- 对平台不支持的媒体（image/file）采取“友善退化”：尽可能退化为可读文本（例如使用 `alt/url/name`）而不是直接报错

如果你希望严格控制顺序/失败策略/重试/拆分边界，请使用显式接口 `msg.sendText/msg.sendImage/msg.sendFile` 自行编排。

### 2) 拆分算法（稳定、与平台能力相关）

内部通过 `outbound/plan.ts` 做规划：

- 连续的“文本类 Part”（`text/mention/link/styled/codeblock`）会被合并为一次 `sendText`
- 图片与文件会成为独立发送操作
- 当平台 `supportsMixedMedia=true` 且满足“单图 caption”形态时，会将相邻文本作为 caption 与图片同条发送：
  - caption 必须位于图片同一侧（全在前或全在后）
  - 若图片两侧都有相邻文本，则不会绑定 caption（保持原始顺序，拆成 `text -> image -> text`）
  - 若图片后仍有其它媒体，则不会把 trailing text 当 caption（避免 caption 误绑定）
- 当平台 `supportsMixedMedia=false` 时，图片与文字必然拆成多条（顺序与输入一致）

### 3) 长度限制（不做隐式截断）

- 当平台声明 `maxCaptionLength` 且 caption 超长：
  - `sendImage()`：直接报错（不会自动截断/拆分）
  - `reply()`：默认自动拆分为“图片 + 文本”（可用 `options.mode='strict'` 禁止自动拆分）
- 当平台声明 `maxTextLength` 且文本超长：`reply()/sendText()` 直接报错（由下游决定如何分页/拆分）

## Adapter 约定（平台实现需要提供的能力）

核心接口定义在 `chatbots/bot-layer/src/adapter/index.ts`：

- `render(parts) -> { text, format }`：把“文本类 Part”渲染为平台格式文本（plain/markdown/html）
- `policy.outbound.supportedOps`：声明平台支持的 outbound 原子操作（`text/image/audio/video/file`），Outbound 层据此决定“严格报错 vs best-effort 退化”
- `uploadMedia(session, media)`：当平台需要“先上传再发送”时实现（KOOK 属于此类）；仅在 `media.data` 存在时由 outbound 层调用
- `send(session, op, options)`：发送一个 Outbound 原子操作（text/image/video/audio/file）

## Message 上的显式发送接口（推荐用于复杂编排）

- `msg.sendText(content)`：只允许文本类 Part（其余直接报错）
- `msg.sendImage?.(image, caption?)`：caption 只允许文本类 Part；是否允许混排由平台能力决定
- `msg.sendFile?.(file)`

它们来自 `createSendHelpers(adapter, session)`：不做“智能遍历 Part[]”，只提供原子能力；复杂顺序/失败策略由下游自行决定。

## 用户头像（Avatar）注意事项

bot-layer 提供两类能力：

- `resolveUserAvatarUrl/resolveAuthorAvatarUrl`：返回可访问的头像 URL（若平台/上下文允许）
- `resolveUserAvatarImage/resolveAuthorAvatarImage`：返回头像二进制（`Buffer`），适合需要“拿头像做图/再上传”的场景
- `collectMedia/resolveMedia`：统一收集并解析媒体（`avatar/image/file`）为 `Buffer`（支持去重、并发、取消）

Telegram 特别说明：

- Telegram Bot API 的头像通常需要 `getUserProfilePhotos + getFile` 才能拿到实际图片；文件 URL 会包含 bot token（形如 `.../file/bot<TOKEN>/...`）
- 若你不希望在业务侧暴露 token 或不方便直接 fetch URL，优先使用 `resolve*AvatarImage` 或 `collectMedia/resolveMedia`（内部完成拉取并返回 `Buffer`）
- 若 `getUserProfilePhotos` 返回 `total_count=0`，通常意味着：用户没有头像或头像隐私设置对 bot 不可见（需要用户侧调整）。

### 推荐用法：统一媒体管线

当你需要“尽量从上下文里拿到图片输入”（例如：头像优先，其次取消息/引用中的图片附件），建议使用：

- `await collectMedia(msg, { includeAvatars: true, avatarPrefer: 'public' })`
- `await resolveMedia(items, { concurrency: 4, signal })`
