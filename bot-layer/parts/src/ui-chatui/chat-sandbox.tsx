import '@chatui/core/dist/index.css'

import Chat, {
	Bubble,
	Image,
	SystemMessage,
	useMessages,
} from '@chatui/core/es'
import type { MessageProps, QuickReplyItemProps } from '@chatui/core'
import { Badge, Group, Paper, Stack, Text } from '@mantine/core'
import { IconMessage2 } from '@tabler/icons-react'
import { useCallback } from 'react'

import type { PartInput } from '../model'
import { normalizeMessageContent } from '../normalize'
import { PartsMessage } from './parts/renderer'
import { PartsShowcasePanel } from './parts/showcase'
import { demoImage, quickReplies, sampleCatalog, sampleInputs, sampleSections } from './parts/samples'

const highlightSample = sampleCatalog.find((item) => item.highlight) ?? sampleCatalog[0]

const initialMessages: Omit<MessageProps, '_id'>[] = [
	{
		type: 'system',
		position: 'center',
		content: { text: 'Bot-layer Parts Sandbox 已就绪' },
	},
	...(highlightSample
		? [
				{
					type: 'parts',
					user: { name: 'Bot-layer' },
					content: {
						parts: normalizeMessageContent([
							{ type: 'text', text: `【${highlightSample.label}】 ` },
							highlightSample.input,
						]),
					},
				},
			]
		: []),
]

export function ChatSandboxPage() {
	const { messages, appendMsg } = useMessages(initialMessages)

	const appendPartsMessage = useCallback(
		(input: PartInput, position: 'left' | 'right') => {
			appendMsg({
				type: 'parts',
				position,
				user: { name: position === 'right' ? 'You' : 'Bot-layer' },
				content: { parts: normalizeMessageContent(input) },
			})
		},
		[appendMsg],
	)

	const handleSend = useCallback(
		(type: string, value: string) => {
			if (type !== 'text') return
			const text = value.trim()
			if (!text) return
			appendPartsMessage(text, 'right')
		},
		[appendPartsMessage],
	)

	const handleQuickReplyClick = useCallback(
		(item: QuickReplyItemProps) => {
			const code = item.code ?? 'text'
			const input = sampleInputs[code]
			if (!input) return
			appendPartsMessage(input, 'left')
		},
		[appendPartsMessage],
	)

	const handleUseSample = useCallback(
		(input: PartInput, label: string) => {
			appendPartsMessage([
				{ type: 'text', text: `【${label}】 ` },
				input,
			], 'left')
		},
		[appendPartsMessage],
	)

	const renderMessageContent = useCallback((msg: MessageProps) => {
		if (msg.type === 'system') {
			return <SystemMessage content={msg.content?.text ?? ''} />
		}
		if (msg.type === 'parts') {
			return <PartsMessage parts={msg.content?.parts ?? []} mode="chat" />
		}
		if (msg.type === 'image') {
			return <Image src={msg.content?.url ?? demoImage} alt={msg.content?.alt ?? 'image'} />
		}
		return <Bubble content={msg.content?.text ?? ''} />
	}, [])

	return (
		<Stack gap="lg" p="lg">
			<Group gap="sm" align="center">
				<IconMessage2 size={24} />
				<Text size="xl" fw={700}>
					Chat Sandbox
				</Text>
				<Badge variant="light" color="cyan">
					ChatUI
				</Badge>
				<Badge variant="light" color="grape">
					Parts
				</Badge>
			</Group>
			<Text size="sm" c="dimmed">
				左侧是对话沙盒，右侧是完整 Parts 示例库，可一键插入对话。
			</Text>
			<Group align="flex-start" wrap="wrap" gap="lg">
				<Paper
					withBorder
					radius="md"
					p="sm"
					style={{ flex: '1 1 520px', minWidth: 320 }}
				>
					<Chat
						navbar={{ title: 'Bot-layer Chat Sandbox' }}
						messages={messages}
						renderMessageContent={renderMessageContent}
						onSend={handleSend}
						placeholder="输入消息，回车发送"
						quickReplies={quickReplies}
						quickRepliesVisible
						onQuickReplyClick={handleQuickReplyClick}
						wideBreakpoint="900px"
					/>
				</Paper>
				<Paper
					withBorder
					radius="md"
					p="sm"
					style={{ flex: '1 1 360px', minWidth: 280 }}
				>
					<PartsShowcasePanel sections={sampleSections} onUseSample={handleUseSample} />
				</Paper>
			</Group>
		</Stack>
	)
}
