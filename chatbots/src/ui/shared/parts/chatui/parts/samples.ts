import type { QuickReplyItemProps } from '@chatui/core'

import type { PartInput } from '@pluxel/bot-layer/web'

export type SampleItem = {
	key: string
	label: string
	input: PartInput
	highlight?: boolean
}

export type SampleSection = {
	key: string
	label: string
	items: SampleItem[]
}

const demoImageSvg =
	'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
	'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
	'<stop offset="0%" stop-color="#e0f2fe"/><stop offset="100%" stop-color="#fde68a"/></linearGradient></defs>' +
	'<rect width="640" height="360" fill="url(#g)"/>' +
	'<circle cx="120" cy="100" r="48" fill="#38bdf8"/>' +
	'<circle cx="520" cy="260" r="64" fill="#fb7185"/>' +
	'<text x="320" y="190" font-size="28" text-anchor="middle" fill="#0f172a" font-family="sans-serif">ChatUI Sandbox</text>' +
	'</svg>'

export const demoImage = `data:image/svg+xml;utf8,${encodeURIComponent(demoImageSvg)}`

const encodeText = (value: string) => {
	if (typeof TextEncoder === 'undefined') return new Uint8Array()
	return new TextEncoder().encode(value)
}

const demoImageBytes = encodeText(demoImageSvg)
const demoFileBytes = encodeText('[bot-layer] log line 1\n[bot-layer] log line 2\n')

export const sampleSections: SampleSection[] = [
	{
		key: 'text',
		label: 'Text & Inline',
		items: [
			{
				key: 'text',
				label: 'Text',
				input: ['纯文本消息，支持换行。\n', '可以直接用输入框发送。'],
			},
			{
				key: 'mention',
				label: 'Mention',
				input: [
					'提及示例：',
					{ type: 'mention', kind: 'user', displayName: '小鹿', id: 'u-1001' },
					' ',
					{ type: 'mention', kind: 'role', displayName: '管理员', id: 'r-9' },
					' ',
					{ type: 'mention', kind: 'channel', displayName: 'general', id: 'c-3' },
					' ',
					{ type: 'mention', kind: 'everyone' },
				],
			},
			{
				key: 'link',
				label: 'Link',
				input: ['点击访问 ', { type: 'link', url: 'https://chatui.io', label: 'ChatUI 官网' }, '。'],
			},
			{
				key: 'styled',
				label: 'Styled',
				input: [
					'样式：',
					{
						type: 'styled',
						style: 'bold',
						children: [
							{ type: 'text', text: '加粗' },
							{ type: 'text', text: ' + ' },
							{
								type: 'styled',
								style: 'italic',
								children: [{ type: 'text', text: '嵌套斜体' }],
							},
							{ type: 'text', text: ' + ' },
							{ type: 'link', url: 'https://pluxel.ai', label: '链接' },
						],
					},
					' ',
					{ type: 'styled', style: 'strike', children: [{ type: 'text', text: '删除线' }] },
					' ',
					{ type: 'styled', style: 'code', children: [{ type: 'text', text: 'inline()' }] },
				],
			},
			{
				key: 'codeblock',
				label: 'Codeblock',
				input: [
					'代码块示例：',
					{
						type: 'codeblock',
						language: 'ts',
						code: [
							"const parts: Part[] = [",
							"  { type: 'text', text: 'hello' },",
							"  { type: 'image', url: 'https://...' },",
							']',
						].join('\n'),
					},
				],
			},
		],
	},
	{
		key: 'media',
		label: 'Media',
		items: [
			{
				key: 'image',
				label: 'Image(url)',
				input: [
					{ type: 'image', url: demoImage, alt: 'Demo', width: 640, height: 360, size: 24_000 },
					'图片可作为单条或混排 caption。',
				],
			},
			{
				key: 'image-data',
				label: 'Image(data)',
				input: [
					{
						type: 'image',
						alt: 'Image from data',
						name: 'sandbox.svg',
						mime: 'image/svg+xml',
						data: demoImageBytes,
						size: demoImageBytes.byteLength,
						fileId: 'img-raw-01',
					},
					'通过 data/mime 生成图片预览。',
				],
			},
			{
				key: 'file',
				label: 'File(url)',
				input: [
					{
						type: 'file',
						url: 'https://example.com/spec.pdf',
						name: 'bot-layer-spec.pdf',
						mime: 'application/pdf',
						size: 194_560,
						fileId: 'file-remote-1',
					},
				],
			},
			{
				key: 'file-data',
				label: 'File(data)',
				input: [
					{
						type: 'file',
						name: 'session.log',
						mime: 'text/plain',
						data: demoFileBytes,
						size: demoFileBytes.byteLength,
						fileId: 'file-local-1',
					},
				],
			},
		],
	},
	{
		key: 'mixed',
		label: 'Mixed',
		items: [
			{
				key: 'mixed',
				label: 'Mixed',
				highlight: true,
				input: [
					'混排示例：',
					new Set<PartInput>([
						{ type: 'styled', style: 'bold', children: [{ type: 'text', text: '文字 + 媒体 + 结构化' }] },
						'\n',
					]),
					[
						{ type: 'image', url: demoImage, alt: 'Mixed Media', fileId: 'img-remote-2' },
						{ type: 'text', text: '查看链接 ' },
						{ type: 'link', url: 'https://pluxel.ai', label: 'Pluxel' },
						{ type: 'text', text: ' 或下载资料：' },
						{ type: 'file', url: 'https://example.com/brief.zip', name: 'brief.zip', size: 52_400 },
					],
					{
						type: 'codeblock',
						language: 'ts',
						code: 'reply([text(\"hello\"), image(\"...\"), file(\"...\")])',
					},
				],
			},
		],
	},
]

export const sampleCatalog = sampleSections.flatMap((section) => section.items)

export const sampleInputs = Object.fromEntries(
	sampleCatalog.map((item) => [item.key, item.input]),
) as Record<string, PartInput>

export const quickReplies: QuickReplyItemProps[] = sampleCatalog.map((item) => ({
	name: item.label,
	code: item.key,
	isHighlight: item.highlight,
}))
