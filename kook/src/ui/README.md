# UI structure (KOOK)

Goal: keep UI code easy to navigate for humans + LLMs.

## Layout

- `app/entry.tsx`: UI module entry (register extensions / routes).
- `app/runtime.ts`: `useKookRuntime()` → `ctx.services.hmr.{rpc,sse}`.
- `features/status/`
  - `types.ts`: feature-local type aliases.
  - `model.ts`: data hooks / SSE subscriptions.
  - `consts.ts`: UI-only constants & format helpers.
  - `components.tsx`: reusable widgets (cards/forms/badges).
  - `panels.tsx`: “page composition” (tabs/info panels).

