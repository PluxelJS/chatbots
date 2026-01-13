# Parts & Content helpers

This package provides a tag-based DSL for bot message content, plus small helper utilities:

- `parts\`...\`` (recommended when you want builder-safe interpolation)
- `mc.*` helpers (recommended for simple “text/json/media” and explicit multi-message batches)

Notes:
- Bundlers (rolldown/tsdown/Vite) can rewrite `parts\`...\`` at build time to a `Part[]` array literal (no runtime helper call).
- Without a bundler, `parts\`...\`` still works as a runtime fallback.

## Install / Build integration (rolldown / tsdown)

Add the transform plugin to your bundler config:

```ts
import { defineConfig } from 'tsdown'
import { partsTransformPlugin } from 'pluxel-plugin-bot-core/parts/rolldown'

export default defineConfig({
	plugins: [partsTransformPlugin()],
})
```

## Install / Build integration (Vite)

```ts
import { defineConfig } from 'vite'
import { partsTransformVitePlugin } from 'pluxel-plugin-bot-core/parts/rolldown'

export default defineConfig({
	plugins: [partsTransformVitePlugin()],
})
```

## Basic usage

```ts
import { parts, p } from 'pluxel-plugin-bot-core'

const userId = 123
const msg = parts`Hello ${p.text(userId)}!`
// msg: Part[]
```

## Content helpers (minimal, stable API)

```ts
import { mc, parts, p } from 'pluxel-plugin-bot-core'

// Single message content (always returns Part[])
return mc.text('hello')

// Explicitly multiple messages (ordered)
return mc.batch('first', parts`second: ${p.code('ok')}`)
```

## DSL builders (recommended)

All builders are designed to be safe inside `${...}`:

- They return `Part`.
- You are responsible for ensuring values are valid (non-empty url, valid ids, etc).
  Invalid parts will be rejected at the send boundary (see validation section).

```ts
import { parts, mentionUser, bold, link, image, p } from 'pluxel-plugin-bot-core'

const msg = parts`Hi ${mentionUser(1)} ${bold('welcome')} ${link('https://example.com', 'docs')}`
const msg2 = parts`Avatar: ${image('https://example.com/a.png')}`

// If you don't want to import builders one-by-one, use the `p.*` namespace:
const msg3 = parts`Docs: ${p.link('https://example.com', 'docs')}`
```

## i18n

If your i18n requires function calls (e.g. `t('key')`), call it **outside** the template and wrap the result with `p.text()`:

```ts
const title = t('welcome.title') // string
return parts`${p.text(title)} ${mentionUser(userId)}`
```

## Runtime validation (send boundary)

Outbound send/reply paths validate `Part[]` and throw early if the structure is invalid
(e.g. mention without id, empty link url, media without url/data/fileId).

If you construct parts manually, prefer `assertValidParts(parts)` before sending.
