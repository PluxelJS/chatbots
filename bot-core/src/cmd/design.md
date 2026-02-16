# Commands (bot-core)

bot-core 的 `src/cmd` 仅 re-export `@pluxel/cmd`（cmdkit）。命令核心设计与完整 API 说明见：`packages/cmd/DESIGN.md`。

本文件只描述 bot-core 在 chat 层的使用约定与最小心智模型。

## 心智模型

- `cmdkit` 的唯一入口是 `cmd(id)` builder，最终产物是 `Executable`：
  - `exec.run(value, ctx?)`：以 object/MCP 风格执行（候选值是 `value`）
  - `exec.runText(text, ctx?)`：以 text 风格执行（要求 `.text(...)` 启用）
- `createRouter()` 做文本路由（最长匹配），`router.dispatch(text, ctx?)` 负责选择并执行命令。
- `input(schema)` 是“规范 input”（候选值会被校验/转换），未设置时默认是严格 `{}`。
- `.text({ triggers, ... })` 是“文本入口开关”：
  - 不调用 `.text()`：该 executable 不可被 text router 触发
  - `.text()` 会基于 `input(schema)` 的 JSON Schema 自动派生参数解析（`--k=v` / `--k v` / `-k v` / `--no-k` 等）
  - 如需 positional 语法（“剩余文本”），使用 `.text({ tail })` + ParseBox 将 tail 映射成 input patch（仍会走 schema 校验）

## Chat 集成

chat 层提供 `createChatCommandRouter()` 与 `handleChatCommand()`（见 `../chat/commands.ts`）：

- 解析 `/cmd args`（支持 Telegram `/cmd@botname` stripping）
- 通过 `router.dispatch(parsed.input, ctx)` 执行
- unknown command 通过捕获 `CmdError(code=E_CMD_NOT_FOUND)` 判断（与“void result”不冲突）
- 默认 ctx 注入 `actorId/traceId/now`，也可用 `makeCtx(msg)` 覆盖

## 错误约定（CmdError）

- `E_CMD_NOT_FOUND`：unknown command（chat 层通常不自动回复）
- `E_ARGV_PARSE`：文本参数解析失败（可提示“参数错误”）
- `E_INPUT_VALIDATION`：输入校验失败（可提示“输入不合法”）
- `E_INTERNAL`：未预期错误（建议对外隐藏细节）
