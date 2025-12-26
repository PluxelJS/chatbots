import {
	Bubble,
	Card,
	CardContent,
	CardMedia,
	CardText,
	FileCard,
	Image,
	ImageList,
	Tag,
} from '@chatui/core/es'
import { useEffect, useMemo, type ReactNode } from 'react'

import type {
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	MentionPart,
	Part,
} from '../../model'

const isTextLike = (part: Part): part is InlinePart | CodeBlockPart => {
	return part.type !== 'image' && part.type !== 'file'
}

const mentionLabel = (part: MentionPart): string => {
	if (part.kind === 'everyone') return '@everyone'
	const name = part.displayName ?? part.username ?? part.id ?? part.kind
	if (part.kind === 'channel') return `#${name}`
	return `@${name}`
}

const renderInlineSequence = (parts: InlinePart[], prefix: string): ReactNode[] => {
	return parts.map((part, index) => {
		const key = `${prefix}-${index}`
		if (part.type === 'text') {
			return (
				<span key={key} style={{ whiteSpace: 'pre-wrap' }}>
					{part.text}
				</span>
			)
		}
		if (part.type === 'mention') {
			return (
				<Tag key={key} color="primary">
					{mentionLabel(part)}
				</Tag>
			)
		}
		if (part.type === 'link') {
			return (
				<a
					key={key}
					href={part.url}
					target="_blank"
					rel="noreferrer"
					style={{ color: '#2563eb', textDecoration: 'underline' }}
				>
					{part.label ?? part.url}
				</a>
			)
		}
		if (part.type === 'styled') {
			const children = renderInlineSequence(part.children, `${prefix}-styled-${index}`)
			if (part.style === 'bold') return <strong key={key}>{children}</strong>
			if (part.style === 'italic') return <em key={key}>{children}</em>
			if (part.style === 'strike') return <s key={key}>{children}</s>
			return (
				<code
					key={key}
					style={{
						background: 'rgba(15, 23, 42, 0.08)',
						borderRadius: 6,
						padding: '0 6px',
						fontSize: 13,
					}}
				>
					{children}
				</code>
			)
		}
		return null
	})
}

const renderCodeBlock = (part: CodeBlockPart) => {
	return (
		<pre
			style={{
				background: '#0f172a',
				color: '#e2e8f0',
				padding: '12px 14px',
				borderRadius: 10,
				overflowX: 'auto',
				fontSize: 13,
				margin: 0,
				whiteSpace: 'pre',
			}}
		>
			<code>
				{part.language ? `${part.language}\n` : ''}
				{part.code}
			</code>
		</pre>
	)
}

const renderTextBlocks = (parts: Part[], prefix: string) => {
	const blocks: ReactNode[] = []
	let inlineBuffer: InlinePart[] = []

	const flushInline = () => {
		if (!inlineBuffer.length) return
		blocks.push(
			<div key={`${prefix}-text-${blocks.length}`} style={{ whiteSpace: 'pre-wrap' }}>
				{renderInlineSequence(inlineBuffer, `${prefix}-inline-${blocks.length}`)}
			</div>,
		)
		inlineBuffer = []
	}

	parts.forEach((part) => {
		if (!isTextLike(part)) return
		if (part.type === 'codeblock') {
			flushInline()
			blocks.push(
				<div key={`${prefix}-code-${blocks.length}`} style={{ marginTop: 8 }}>
					{renderCodeBlock(part)}
				</div>,
			)
			return
		}
		inlineBuffer.push(part)
	})

	flushInline()
	return blocks
}

const formatBytes = (value?: number) => {
	if (!value || Number.isNaN(value)) return null
	if (value < 1024) return `${value} B`
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
	return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatMediaMeta = (parts: Array<string | null | undefined>) => {
	const items = parts.filter((item): item is string => Boolean(item))
	return items.length ? items.join(' · ') : null
}

const getImageAspectRatio = (part: ImagePart): 'square' | 'wide' => {
	if (part.width && part.height) {
		return part.width / part.height >= 1.2 ? 'wide' : 'square'
	}
	return 'wide'
}

const useBlobUrl = (data?: Uint8Array | ArrayBufferLike, mime?: string) => {
	const blobUrl = useMemo(() => {
		if (!data) return null
		if (typeof Blob === 'undefined' || typeof URL === 'undefined') return null
		const blob = new Blob([data], { type: mime ?? 'application/octet-stream' })
		return URL.createObjectURL(blob)
	}, [data, mime])

	useEffect(() => {
		if (!blobUrl) return
		return () => {
			URL.revokeObjectURL(blobUrl)
		}
	}, [blobUrl])

	return blobUrl
}

function ImagePartBlock({
	part,
	showMeta,
	showAlt,
}: {
	part: ImagePart
	showMeta: boolean
	showAlt: boolean
}) {
	const blobUrl = useBlobUrl(part.data, part.mime)
	const src = part.url ?? blobUrl
	const meta = formatMediaMeta([
		part.name,
		part.mime,
		part.width && part.height ? `${part.width}x${part.height}` : null,
		formatBytes(part.size ?? part.data?.byteLength),
		part.fileId ? `id:${part.fileId}` : null,
		part.url ? 'src:url' : part.data ? 'src:data' : null,
	])
	const mediaAspect = getImageAspectRatio(part)

	return (
		<>
			{src ? (
				<CardMedia aspectRatio={mediaAspect}>
					<Image
						src={src}
						alt={part.alt ?? 'image'}
						fluid
						style={{ display: 'block', margin: '0 auto' }}
					/>
				</CardMedia>
			) : (
				<CardContent>
					<CardText>Image source unavailable</CardText>
				</CardContent>
			)}
			{showAlt && part.alt && (
				<CardContent>
					<CardText>
						<span style={{ color: '#64748b' }}>{part.alt}</span>
					</CardText>
				</CardContent>
			)}
			{showMeta && meta && (
				<CardContent>
					<CardText>
						<span style={{ color: '#64748b' }}>{meta}</span>
					</CardText>
				</CardContent>
			)}
		</>
	)
}

function ImageListBlock({ parts }: { parts: ImagePart[] }) {
	const items = useMemo(() => {
		if (typeof URL === 'undefined' || typeof Blob === 'undefined') {
			return parts
				.map((item, index) =>
					item.url ? { src: item.url, id: item.fileId ?? `img-${index}`, revoke: null } : null,
				)
				.filter((item): item is { src: string; id: string; revoke: string | null } => Boolean(item))
		}

		return parts
			.map((item, index) => {
				if (item.url) {
					return { src: item.url, id: item.fileId ?? `img-${index}`, revoke: null }
				}
				if (!item.data) return null
				const blob = new Blob([item.data], { type: item.mime ?? 'application/octet-stream' })
				const src = URL.createObjectURL(blob)
				return { src, id: item.fileId ?? `img-${index}`, revoke: src }
			})
			.filter((item): item is { src: string; id: string; revoke: string | null } => Boolean(item))
	}, [parts])

	useEffect(() => {
		return () => {
			for (const item of items) {
				if (item.revoke) URL.revokeObjectURL(item.revoke)
			}
		}
	}, [items])

	if (!items.length) {
		return (
			<CardContent>
				<CardText>Image source unavailable</CardText>
			</CardContent>
		)
	}

	const list = items.map((item) => ({ src: item.src, id: item.id }))
	return (
		<CardContent>
			<ImageList list={list} />
		</CardContent>
	)
}

function FilePartBlock({ part, showMeta }: { part: FilePart; showMeta: boolean }) {
	const blobUrl = useBlobUrl(part.data, part.mime)
	const link = part.url ?? blobUrl
	const name = part.name ?? part.url ?? 'file'
	const extension = name.includes('.') ? name.split('.').pop() : undefined
	const file = useMemo(() => {
		if (typeof File === 'undefined' || typeof Blob === 'undefined') return null
		const blob = part.data
			? new Blob([part.data], { type: part.mime ?? 'application/octet-stream' })
			: new Blob([], { type: part.mime ?? 'application/octet-stream' })
		return new File([blob], name, { type: part.mime ?? 'application/octet-stream' })
	}, [name, part.data, part.mime])
	const meta = formatMediaMeta([
		part.mime,
		formatBytes(part.size ?? part.data?.byteLength),
		part.fileId ? `id:${part.fileId}` : null,
		part.url ? 'src:url' : part.data ? 'src:data' : null,
	])

	return (
		<CardContent>
			{file ? <FileCard file={file} extension={extension} /> : (
				<CardText>
					<strong>File</strong> {name}
				</CardText>
			)}
			{showMeta && meta && (
				<CardText>
					<span style={{ color: '#64748b' }}>{meta}</span>
				</CardText>
			)}
			{link && (
				<CardText>
					<a href={link} target="_blank" rel="noreferrer">
						{part.url ?? '下载附件'}
					</a>
				</CardText>
			)}
		</CardContent>
	)
}

const renderCardBlocks = (
	parts: Part[],
	opts: {
		showMeta: boolean
		showAlt: boolean
	},
) => {
	const blocks: ReactNode[] = []
	let inlineBuffer: InlinePart[] = []
	let imageBuffer: ImagePart[] = []

	const flushInline = () => {
		if (!inlineBuffer.length) return
		blocks.push(
			<CardContent key={`card-text-${blocks.length}`}>
				<CardText>
					<span style={{ whiteSpace: 'pre-wrap' }}>
						{renderInlineSequence(inlineBuffer, `card-inline-${blocks.length}`)}
					</span>
				</CardText>
			</CardContent>,
		)
		inlineBuffer = []
	}

	const flushImages = () => {
		if (!imageBuffer.length) return
		if (imageBuffer.length === 1) {
			blocks.push(
				<ImagePartBlock
					key={`card-media-${blocks.length}`}
					part={imageBuffer[0]!}
					showMeta={opts.showMeta}
					showAlt={opts.showAlt}
				/>,
			)
			imageBuffer = []
			return
		}
		blocks.push(<ImageListBlock key={`card-image-list-${blocks.length}`} parts={imageBuffer} />)
		imageBuffer = []
	}

	parts.forEach((part) => {
		if (part.type === 'image') {
			flushInline()
			imageBuffer.push(part)
			return
		}

		if (part.type === 'file') {
			flushImages()
			flushInline()
			blocks.push(
				<FilePartBlock
					key={`card-file-${blocks.length}`}
					part={part}
					showMeta={opts.showMeta}
				/>,
			)
			return
		}

		if (part.type === 'codeblock') {
			flushImages()
			flushInline()
			blocks.push(
				<CardContent key={`card-code-${blocks.length}`}>{renderCodeBlock(part)}</CardContent>,
			)
			return
		}

		flushImages()
		inlineBuffer.push(part)
	})

	flushImages()
	flushInline()
	return blocks
}

export function PartsMessage({
	parts,
	mode = 'showcase',
}: {
	parts: Part[]
	mode?: 'chat' | 'showcase'
}) {
	const hasMedia = parts.some((part) => part.type === 'image' || part.type === 'file')
	if (!hasMedia) {
		return <Bubble>{renderTextBlocks(parts, 'bubble')}</Bubble>
	}
	const showMeta = mode === 'showcase'
	const showAlt = mode === 'showcase'
	const cardStyle =
		mode === 'showcase'
			? { width: '100%', maxWidth: '100%' }
			: { maxWidth: '32rem' }
	return (
		<Card fluid style={cardStyle}>
			{renderCardBlocks(parts, { showMeta, showAlt })}
		</Card>
	)
}
