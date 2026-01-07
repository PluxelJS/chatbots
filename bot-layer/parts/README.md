# Parts DSL (tag-only)

This package provides a **tag-only** DSL for bot message content:

- You write `parts\`...\``.
- Bundler rewrites it at build time to a call into `@pluxel/bot-layer/parts/runtime`.
- Runtime output is `Part[]` (no tag at runtime).

## Install / Build integration (rolldown / tsdown)

Add the transform plugin to your bundler config:

```ts
import { defineConfig } from 'tsdown'
import { partsTransformPlugin } from '@pluxel/bot-layer/parts/rolldown/parts-transform'

export default defineConfig({
	plugins: [partsTransformPlugin()],
})
```

## Basic usage

```ts
import { parts } from '@pluxel/bot-layer'

const userId = 123
const msg = parts`Hello ${userId}!`
// msg: Part[]
```

## DSL builders (recommended)

All builders are designed to be safe inside `${...}`:

- They return `Part` (or `Part | null` when the input is missing/invalid).
- `null/undefined` are ignored by the runtime.

```ts
import { parts, mentionUser, bold, link, image, p } from '@pluxel/bot-layer'

const msg = parts`Hi ${mentionUser(1)} ${bold('welcome')} ${link('https://example.com', 'docs')}`
const maybeAvatarUrl: string | undefined = undefined
const msg2 = parts`Avatar: ${image(maybeAvatarUrl)}`

// If you don't want to import builders one-by-one, use the `p.*` namespace:
const msg3 = parts`Docs: ${p.link('https://example.com', 'docs')}`
```

## Expression rules inside `${...}` (compile-time enforced)

Allowed forms:

- `Identifier` / `MemberExpression` (including optional chaining)
- `null`, string literal, number literal
- Calls to **allowed DSL builders**:
  - direct: `mentionUser(...)`, `bold(...)`, `link(...)`, `image(...)`, …
  - namespace: `p.mentionUser(...)`, `p.bold(...)`, `p.link(...)`, `p.image(...)`, …

Disallowed (build will fail):

- `a + b`, `ok && x`, `ok ? a : b`, `({})`, `([])`, arrow/functions, nested templates, TS `as`, …

The intent is: **keep templates declarative** and make the transform stable and auditable.

## i18n

If your i18n requires function calls (e.g. `t('key')`), call it **outside** the template and interpolate the result:

```ts
const title = t('welcome.title') // string
return parts`${title} ${mentionUser(userId)}`
```

Inline `${t('key')}` is intentionally rejected to avoid allowing arbitrary calls inside templates.

## Runtime validation (send boundary)

Outbound send/reply paths validate `Part[]` and throw early if the structure is invalid
(e.g. mention without id, empty link url, media without url/data/fileId).

If you construct parts manually, prefer `assertValidParts(parts)` before sending.
