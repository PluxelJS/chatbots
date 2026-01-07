# UI structure (Milky)

Goal: keep UI code easy to navigate for humans + LLMs.

## Layout

- `app/entry.tsx`: UI module entry (register extensions / routes).
- `app/runtime.ts`: `useMilkyRuntime()` → `services.hmr.{rpc,sse}`.
- `features/manage/`
  - `types.ts`: feature-local type aliases.
  - `model.ts`: data hooks / SSE subscriptions.
  - `consts.ts`: UI-only constants & format helpers.
  - `components.tsx`: widgets + panels implementation.
  - `panels.tsx`: public exports for entry (`ManageTab`, `SummaryPanel`).
