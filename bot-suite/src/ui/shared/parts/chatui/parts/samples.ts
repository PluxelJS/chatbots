import type { QuickReplyItemProps } from '@chatui/core'

import type { FilePart, ImagePart, Part } from 'pluxel-plugin-bot-core/web'
import { p, parts } from 'pluxel-plugin-bot-core/web'

export type SampleItem = {
	key: string
	label: string
	input: Part[]
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

const demoImagePart: ImagePart = {
	type: 'image',
	url: demoImage,
	alt: 'Demo',
	width: 640,
	height: 360,
	size: 24_000,
}

const demoImageDataPart: ImagePart = {
	type: 'image',
	alt: 'Image from data',
	name: 'sandbox.svg',
	mime: 'image/svg+xml',
	data: demoImageBytes,
	size: demoImageBytes.byteLength,
	fileId: 'img-raw-01',
}

const demoFileUrlPart: FilePart = {
	type: 'file',
	url: 'https://example.com/spec.pdf',
	name: 'bot-layer-spec.pdf',
	mime: 'application/pdf',
	size: 194_560,
	fileId: 'file-remote-1',
}

export const sampleSections: SampleSection[] = [
	{
		key: 'text',
		label: 'Text & Inline',
		items: [
			{
				key: 'text',
				label: 'Text',
				input: parts`纯文本消息，支持换行。\n可以直接用输入框发送。`,
			},
			{
				key: 'mention',
				label: 'Mention',
				input: parts`提及示例：${p.mentionUser('u-1001', { displayName: '小鹿' })} ${p.mentionRole('r-9', { displayName: '管理员' })} ${p.mentionChannel('c-3', { displayName: 'general' })} ${p.mentionEveryone()}`,
			},
			{
				key: 'link',
				label: 'Link',
				input: parts`点击访问 ${p.link('https://chatui.io', 'ChatUI 官网')}。`,
			},
			{
				key: 'styled',
				label: 'Styled',
				input: parts`样式：${p.bold('加粗', ' + ', p.italic('嵌套斜体'), ' + ', p.link('https://pluxel.ai', '链接'))} ${p.strike('删除线')} ${p.code('inline()')}`,
			},
			{
				key: 'codeblock',
				label: 'Codeblock',
				input: parts`代码块示例：${p.codeblock(
					[
						"const parts: Part[] = [",
						"  { type: 'text', text: 'hello' },",
						"  { type: 'image', url: 'https://...' },",
						']',
						].join('\n'),
						'ts',
				)}`,
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
				input: parts`${demoImagePart}图片可作为单条或混排 caption。`,
			},
			{
				key: 'image-data',
				label: 'Image(data)',
				input: parts`${demoImageDataPart}通过 data/mime 生成图片预览。`,
			},
			{
				key: 'file',
				label: 'File(url)',
				input: [demoFileUrlPart],
			},
			{
				key: 'file-data',
				label: 'File(data)',
				input: [
					{
						...p.fileData(demoFileBytes, { name: 'session.log', mime: 'text/plain', size: demoFileBytes.byteLength }),
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
				input: (() => {
					const image: ImagePart = { type: 'image', url: demoImage, alt: 'Mixed Media', fileId: 'img-remote-2' }
					const file: FilePart = { type: 'file', url: 'https://example.com/brief.zip', name: 'brief.zip', size: 52_400 }
					return parts`混排示例：${p.bold('文字 + 媒体 + 结构化')}\n${image}查看链接 ${p.link('https://pluxel.ai', 'Pluxel')} 或下载资料：${file}\n${p.codeblock(
						"reply(parts`hello ${p.mentionUser(id)}`)",
						'ts',
					)}`
				})(),
			},
		],
	},
]

export const sampleCatalog = sampleSections.flatMap((section) => section.items)

export const sampleInputs = Object.fromEntries(
	sampleCatalog.map((item) => [item.key, item.input]),
) as Record<string, Part[]>

export const quickReplies: QuickReplyItemProps[] = sampleCatalog.map((item) => ({
	name: item.label,
	code: item.key,
	isHighlight: item.highlight,
}))
