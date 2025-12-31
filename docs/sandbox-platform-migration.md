# Sandbox 平台适配器迁移方案

将 Sandbox 从嵌入式实现迁移为与 kook/telegram 同级的平台适配器。

## 概述

当前 Sandbox 是一个嵌入式实现，UI 直接通过 RPC 调用后端。迁移后，Sandbox 将成为一个完整的"平台"，遵循与其他平台相同的架构模式。

## 需要更改的文件

### 1. bot-layer 类型定义

**文件**: `chatbots/bot-layer/src/types.ts`

```typescript
// 在 PlatformRegistry 中添加 sandbox
export interface PlatformRegistry {
  kook: { ... }
  telegram: { ... }
  sandbox: {
    raw: SandboxSession  // 自定义的原始会话类型
    bot: SandboxBot      // 沙盒 bot 实例
    userId: string
    channelId: string
    guildId: never
    messageId: string
  }
}
```

### 2. 创建 Sandbox 平台适配器

**新建文件**: `chatbots/bot-layer/src/adapters/sandbox.ts`

需要实现：
- `SandboxBot` - Bot 实例类型
- `SandboxSession` - 原始会话类型
- `createSandboxMessage(session, options): Message<'sandbox'>` - 消息工厂
- `SandboxAdapter` - 平台适配器类

```typescript
// 核心接口实现
export interface SandboxAdapter {
  platform: 'sandbox'
  policy: AdapterPolicy
  createMessage(input: SandboxInput): Message<'sandbox'>
  // reply/sendText/sendImage/sendFile 实现
}
```

### 3. 平台策略声明（Policy）

**文件**: `chatbots/bot-layer/src/sandbox.ts`

```typescript
export const sandboxPolicy: AdapterPolicy = {
  text: {
    format: 'plain',
    inlineMention: {
      user: 'native',
      role: 'native',
      channel: 'native',
      everyone: 'native',
    },
    maxTextLength: undefined,
  },
  outbound: {
    supportsQuote: true,
    supportsMixedMedia: true,
    supportedOps: ['text', 'image', 'audio', 'video', 'file'],
    maxCaptionLength: undefined,
  },
}
```

### 4. 后端 RPC 处理

**文件**: `chatbots/chatbots/core/sandbox-rpc.ts` (现有文件需重构)

变更：
- `send()` 方法改为构造 `Message<'sandbox'>` 并通过 bus 分发
- 消息回复通过 adapter 的 `reply()` 实现，而非直接追加
- 移除直接的消息存储逻辑，改用 adapter 内部处理

### 5. 消息存储与事件

**文件**: `chatbots/chatbots/core/sandbox-store.ts` (新建或重构)

- Adapter 的 `reply()` 调用后，将消息存入 store
- Store 变更时通过 SSE 推送给 UI
- 考虑是否需要持久化（当前是内存存储）

### 6. UI 层简化

**文件**: `chatbots/chatbots/ui/sandbox.tsx`

变更：
- 保持现有 UI 逻辑
- RPC 调用保持不变（但后端实现变了）
- Mock 配置依然通过 `SandboxSendInput` 传递

### 7. 导出与注册

**文件**: `chatbots/bot-layer/src/index.ts`

```typescript
export * from './adapters/sandbox'
export type { Message, Platform } from './types'  // Platform 现在包含 'sandbox'
```

## 具体实现要点

### Message<'sandbox'> 实现

```typescript
interface SandboxMessage extends Message<'sandbox'> {
  platform: 'sandbox'
  text: string
  textRaw: string
  parts: Part[]
  mentions: MentionPart[]
  attachments: Attachment<'sandbox'>[]
  reference?: MessageReference<'sandbox'>
  rich: boolean
  user: BotUser<'sandbox'>
  channel: BotChannel<'sandbox'>
  messageId: string | null
  raw: SandboxSession
  bot: SandboxBot
  reply: (content: MessageContent, options?: ReplyOptions) => Promise<void>
  sendText: (content: MessageContent, options?: ReplyOptions) => Promise<void>
  sendImage?: (image: ImagePart, caption?: MessageContent, options?: ReplyOptions) => Promise<void>
  sendAudio?: (audio: AudioPart, options?: ReplyOptions) => Promise<void>
  sendVideo?: (video: VideoPart, caption?: MessageContent, options?: ReplyOptions) => Promise<void>
  sendFile?: (file: FilePart, options?: ReplyOptions) => Promise<void>
}
```

### reply() 实现逻辑

```typescript
async reply(content: MessageContent, options?: ReplyOptions): Promise<void> {
  const parts = normalizeMessageContent(content)
  const rendered = renderParts(parts, sandboxPolicy)

  // 存储 bot 回复消息
  sandboxStore.append({
    id: generateId(),
    role: 'bot',
    parts: rendered,
    text: partsToText(rendered),
    platform: 'sandbox',
    userId: this.user.id,
    channelId: this.channel.id,
    createdAt: Date.now(),
  })

  // SSE 推送会自动触发
}
```

### Mock 数据注入

在 `createSandboxMessage()` 中使用 mock 数据：

```typescript
function createSandboxMessage(input: SandboxSendInput): Message<'sandbox'> {
  return {
    platform: 'sandbox',
    user: {
      id: input.userId ?? 'sandbox-user',
      username: input.mockUser?.username ?? 'sandbox',
      displayName: input.mockUser?.displayName ?? 'Sandbox User',
      avatar: input.mockUser?.avatar ?? DEFAULT_AVATAR,
      isBot: input.mockUser?.isBot ?? false,
    },
    channel: {
      id: input.channelId ?? 'sandbox-channel',
      guildId: null,
      name: input.mockChannel?.name ?? 'sandbox-channel',
      isPrivate: input.mockChannel?.isPrivate ?? false,
    },
    // ... 其他字段
  }
}
```

## 迁移步骤

1. **准备阶段**
   - [ ] 在 `PlatformRegistry` 添加 `sandbox` 类型定义
   - [ ] 定义 `SandboxBot` 和 `SandboxSession` 类型

2. **Adapter 实现**
   - [ ] 创建 `chatbots/bot-layer/src/adapters/sandbox.ts`
   - [ ] 实现 `createSandboxMessage()` 工厂函数
   - [ ] 实现 `reply()`, `sendText()`, `sendImage()`, `sendFile()`

3. **后端重构**
   - [ ] 重构 `sandbox-rpc.ts` 使用 adapter
   - [ ] 确保消息通过 bus 正确路由
   - [ ] 验证 SSE 推送正常工作

4. **测试**
   - [ ] 验证命令执行流程与 kook/telegram 一致
   - [ ] 验证 mock 数据正确注入
   - [ ] 验证权限系统与 mockRoleIds 配合工作

5. **清理**
   - [ ] 移除旧的嵌入式实现代码
   - [ ] 更新相关文档

## 注意事项

- **类型安全**: `Platform` 类型联合会自动包含 `'sandbox'`，TypeScript 会强制实现所有必需字段
- **向后兼容**: UI 层 RPC 接口保持不变，迁移对前端透明
- **测试覆盖**: 迁移后 sandbox 会经过与生产相同的代码路径，测试更可靠
- **权限模拟**: `mockRoleIds` 需要在消息处理前注入到权限检查上下文中

## 可选增强

- 支持 sandbox 的消息持久化（SQLite/文件）
- 支持多个独立的 sandbox 实例（不同 channelId）
- 支持 sandbox 的 webhook 模式（外部测试工具调用）
