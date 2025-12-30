import { Badge, Box, Divider, Group, Paper, ScrollArea, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconLayoutGrid } from '@tabler/icons-react'

import { PartsShowcasePanel, sampleSections } from './parts-ui-chatui'
import { ChatUiShowcasePanel } from './chatui-showcase'
import { useChatUiColorScheme } from './styles'

export function ChatbotsShowcasePage() {
	useChatUiColorScheme()

	const isStacked = useMediaQuery('(max-width: 1200px)', undefined, {
		getInitialValueInEffect: true,
	})
	const partsCount = sampleSections.reduce((acc, section) => acc + section.items.length, 0)

	const header = (
		<Paper withBorder radius="lg" p="md">
			<Group justify="space-between" align="center" wrap="wrap" gap="md">
				<Group gap="sm" align="center">
					<IconLayoutGrid size={24} />
					<Stack gap={2}>
						<Text size="lg" fw={700}>
							ChatUI Showcase
						</Text>
						<Text size="xs" c="dimmed">
							Preview Parts rendering and ChatUI components without sending messages.
						</Text>
					</Stack>
				</Group>
				<Group gap="xs">
					<Badge variant="light" color="grape">
						Parts
					</Badge>
					<Badge variant="light" color="cyan">
						ChatUI
					</Badge>
				</Group>
			</Group>
		</Paper>
	)

	const partsPanel = (
		<Paper
			withBorder
			radius="lg"
			p="sm"
			style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}
		>
			<Group justify="space-between" align="center" mb="xs">
				<Text fw={600}>Parts Catalog</Text>
				<Badge variant="light" color="grape">
					{partsCount} 项
				</Badge>
			</Group>
			<Divider mb="sm" />
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<PartsShowcasePanel sections={sampleSections} onUseSample={() => {}} />
			</ScrollArea>
		</Paper>
	)

	const chatUiPanel = (
		<Paper
			withBorder
			radius="lg"
			p="sm"
			style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}
		>
			<Group justify="space-between" align="center" mb="xs">
				<Text fw={600}>ChatUI Components</Text>
				<Badge variant="light" color="cyan">
					ChatUI
				</Badge>
			</Group>
			<Divider mb="sm" />
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<ChatUiShowcasePanel />
			</ScrollArea>
		</Paper>
	)

	return (
		<Box style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
			{header}
			{isStacked ? (
				<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
					<Stack gap="lg" pr="xs">
						<Box style={{ minHeight: 520 }}>{partsPanel}</Box>
						<Box style={{ minHeight: 520 }}>{chatUiPanel}</Box>
					</Stack>
				</ScrollArea>
			) : (
				<Box
					style={{
						flex: 1,
						minHeight: 0,
						display: 'grid',
						gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
						gridTemplateRows: 'minmax(0, 1fr)',
						gap: 16,
						overflow: 'hidden',
					}}
				>
					<Box style={{ minHeight: 0, height: '100%', overflow: 'hidden' }}>{partsPanel}</Box>
					<Box style={{ minHeight: 0, height: '100%', overflow: 'hidden' }}>{chatUiPanel}</Box>
				</Box>
			)}
		</Box>
	)
}
