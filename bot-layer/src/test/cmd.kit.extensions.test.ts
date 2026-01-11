import { describe, expect, it } from 'bun:test'

import { createCommandBus, defineCommand } from '../cmd'
import { createCommandKit, getCommandMeta, type CommandKitPlugin } from '../cmd/kit'

declare module '../cmd/kit' {
	interface CommandMetaExt {
		tag?: string
	}
}

describe('cmd/createCommandKit extensions', () => {
	it('supports plugins extending builder + meta()', () => {
		const bus = createCommandBus<any>({ caseInsensitive: true })

		const tagPlugin: CommandKitPlugin<any> = {
			extendBuilder(builder) {
				;(builder as any).tag = function tag(this: any, value: string) {
					this.meta({ tag: value })
					return this
				}
				return builder
			},
		}

		const kit = createCommandKit(bus, { plugins: [tagPlugin] })
		;(kit.reg('x') as any).tag('hello').action(() => 'ok')

		const cmd = kit.list()[0]!
		expect(cmd.pattern).toBe('x')
		expect(getCommandMeta(cmd)?.tag).toBe('hello')
	})

	it('keeps help() working with desc/group', () => {
		const bus = createCommandBus<any>({ caseInsensitive: true })
		const kit = createCommandKit(bus)

		kit.group('g', (k) => {
			k.reg('a').describe('A').action(() => 'ok')
			k.reg('b').describe('B').action(() => 'ok')
		})

		const help = kit.help('g')
		expect(help).toContain('# g')
		expect(help).toContain('- a')
		expect(help).toContain('— A')
	})
})

