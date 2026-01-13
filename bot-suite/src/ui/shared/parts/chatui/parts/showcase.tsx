import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { IconSparkles } from '@tabler/icons-react'
import { useMemo } from 'react'

import type { Part } from 'pluxel-plugin-bot-core'
import { PartsMessage } from './renderer'
import type { SampleItem, SampleSection } from './samples'

type PartsShowcasePanelProps = {
	sections: SampleSection[]
	onUseSample: (input: Part[], label: string) => void
}

type SampleCardProps = {
	item: SampleItem
	onUseSample: (input: Part[], label: string) => void
}

function PartsSampleCard({ item, onUseSample }: SampleCardProps) {
	const parts = useMemo(() => item.input, [item.input])

	return (
		<Paper key={item.key} withBorder radius="md" p="sm">
			<Stack gap="xs">
				<Group justify="space-between" align="center">
					<Group gap="xs">
						<Text fw={600}>{item.label}</Text>
						{item.highlight && (
							<Badge size="xs" color="grape" variant="light">
								推荐
							</Badge>
						)}
					</Group>
					<Button size="xs" variant="light" onClick={() => onUseSample(item.input, item.label)}>
						插入对话
					</Button>
				</Group>
				<PartsMessage parts={parts} mode="showcase" />
			</Stack>
		</Paper>
	)
}

export function PartsShowcasePanel({ sections, onUseSample }: PartsShowcasePanelProps) {
	const totalCount = useMemo(
		() => sections.reduce((acc, section) => acc + section.items.length, 0),
		[sections],
	)

	return (
		<Stack gap="md">
			<Group justify="space-between" align="center">
				<Group gap="xs" align="center">
					<IconSparkles size={18} />
					<Text fw={600}>Parts 能力示例</Text>
				</Group>
				<Badge variant="light" color="grape">
					{totalCount} 项
				</Badge>
			</Group>
			{sections.map((section) => (
				<Stack key={section.key} gap="xs">
					<Group justify="space-between" align="center">
						<Text fw={600}>{section.label}</Text>
						<Badge size="xs" color="gray" variant="light">
							{section.items.length}
						</Badge>
					</Group>
					<Stack gap="xs">
						{section.items.map((item) => (
							<PartsSampleCard key={item.key} item={item} onUseSample={onUseSample} />
						))}
					</Stack>
				</Stack>
			))}
		</Stack>
	)
}
