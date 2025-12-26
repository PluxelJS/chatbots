import {
	Avatar,
	Button,
	Card,
	CardContent,
	CardText,
	Carousel,
	CheckboxGroup,
	Countdown,
	Coupon,
	Divider,
	Empty,
	FileCard,
	Filter,
	Flex,
	FlexItem,
	Form,
	FormActions,
	FormItem,
	Goods,
	Image,
	ImageList,
	Input,
	KvItem,
	KvList,
	List,
	ListItem,
	Loading,
	MediaObject,
	MessageStatus,
	Modal,
	MultiRedPacket,
	Navbar,
	Notice,
	OrderObject,
	Popup,
	Price,
	Progress,
	QuickReplies,
	Quote,
	RadioGroup,
	RateActions,
	RedPacket,
	Ribbon,
	RichText,
	ScrollGrid,
	ScrollView,
	Search,
	Select,
	Skeleton,
	StatusBadge,
	Step,
	Stepper,
	Tab,
	Tabs,
	Tag,
	Text as ChatText,
	Think,
	Time,
	Tips,
	Typing,
	TypingBubble,
	toast,
} from '@chatui/core/es'
import type { FilterValue, QuickReplyItemProps } from '@chatui/core'
import { Group, Paper, Stack, Text } from '@mantine/core'
import { useMemo, useState, type ReactNode } from 'react'

import { demoImage } from '@pluxel/parts/ui-chatui'

type SectionProps = {
	title: string
	children: ReactNode
}

function Section({ title, children }: SectionProps) {
	return (
		<Paper withBorder radius="md" p="sm">
			<Text fw={600}>{title}</Text>
			<Stack gap="sm" mt="sm">
				{children}
			</Stack>
		</Paper>
	)
}

const quickReplyItems: QuickReplyItemProps[] = [
	{ name: 'Hello', code: 'hello' },
	{ name: 'Docs', code: 'docs', isHighlight: true },
	{ name: 'Support', code: 'support' },
]

const imageList = [
	{ src: demoImage, id: 'img-1' },
	{ src: demoImage, id: 'img-2' },
	{ src: demoImage, id: 'img-3' },
]

const goodsList = [
	{
		name: 'Aurora Lamp',
		desc: 'Soft ambient light for focused sessions.',
		price: 89,
		originalPrice: 129,
		img: demoImage,
		tags: [{ name: 'New' }],
		count: 1,
		unit: 'pcs',
		status: 'In stock',
	},
	{
		name: 'Desk Organizer',
		desc: 'Keeps workspace tidy.',
		price: 39,
		img: demoImage,
		tags: [{ name: 'Desk' }],
		count: 1,
		unit: 'pcs',
		status: 'Ready',
	},
]

const orderItems = goodsList.map((item) => ({
	...item,
	variant: 'compact' as const,
}))

const richHtml = [
	'<p><strong>RichText</strong> supports <em>HTML</em> fragments.</p>',
	'<p>Use it for formatted notices or inline docs.</p>',
].join('')

const filterOptions = [
	{
		label: 'Category',
		children: [{ label: 'All' }, { label: 'UI' }, { label: 'API' }],
	},
	{
		label: 'Status',
		children: [{ label: 'Active' }, { label: 'Paused' }, { label: 'Archived' }],
	},
]

const scrollItems = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']

export function ChatUiShowcasePanel() {
	const [rating, setRating] = useState<string | null>(null)
	const [inputValue, setInputValue] = useState('ChatUI input')
	const [searchValue, setSearchValue] = useState('')
	const [selectValue, setSelectValue] = useState('alpha')
	const [checkboxValue, setCheckboxValue] = useState<Array<string | number>>(['alpha'])
	const [radioValue, setRadioValue] = useState<string | number>('alpha')
	const [modalOpen, setModalOpen] = useState(false)
	const [popupOpen, setPopupOpen] = useState(false)
	const [filterValue, setFilterValue] = useState<FilterValue>({
		Category: 'All',
		Status: 'Active',
	})

	const file = useMemo(() => {
		if (typeof File === 'undefined' || typeof Blob === 'undefined') return null
		const blob = new Blob(['ChatUI file card demo.'], { type: 'text/plain' })
		return new File([blob], 'chatui-demo.txt', { type: 'text/plain' })
	}, [])

	return (
		<>
			<Section title="Basics">
				<Group gap="sm" align="center">
					<Avatar src={demoImage} size="sm" />
					<Avatar size="md">AB</Avatar>
					<Tag color="primary">Tag</Tag>
					<Ribbon color="primary">Featured</Ribbon>
				</Group>
				<Group gap="sm" align="center">
					<Button color="primary">Primary</Button>
					<Button variant="outline">Outline</Button>
					<Button variant="text" onClick={() => toast('Saved')}>
						Toast
					</Button>
				</Group>
				<Divider>Layout</Divider>
				<Flex justify="space-between" align="center">
					<FlexItem>
						<ChatText>Flex item A</ChatText>
					</FlexItem>
					<FlexItem>
						<ChatText>Flex item B</ChatText>
					</FlexItem>
				</Flex>
			</Section>

			<Section title="Inputs & Forms">
				<Input
					value={inputValue}
					onChange={(value) => setInputValue(value)}
					placeholder="ChatUI input"
				/>
				<Search
					value={searchValue}
					onChange={(value) => setSearchValue(value)}
					onSearch={(value) => setSearchValue(value)}
					clearable
					showSearch
					placeholder="Search"
				/>
				<Select
					value={selectValue}
					onChange={(event) => setSelectValue(event.currentTarget.value)}
				>
					<option value="alpha">Alpha</option>
					<option value="beta">Beta</option>
					<option value="gamma">Gamma</option>
				</Select>
				<CheckboxGroup
					options={[
						{ label: 'Alpha', value: 'alpha' },
						{ label: 'Beta', value: 'beta' },
					]}
					value={checkboxValue}
					onChange={(value) => setCheckboxValue(value)}
				/>
				<RadioGroup
					options={[
						{ label: 'Alpha', value: 'alpha' },
						{ label: 'Beta', value: 'beta' },
						{ label: 'Gamma', value: 'gamma' },
					]}
					value={radioValue}
					onChange={(value) => setRadioValue(value)}
				/>
				<Form>
					<FormItem label="Name" required>
						<Input value="Chatbot" onChange={() => {}} />
					</FormItem>
					<FormItem label="Notes" help="Form with Input + Actions">
						<Input value="Ready to ship" onChange={() => {}} />
					</FormItem>
					<FormActions>
						<Button color="primary">Submit</Button>
						<Button variant="outline">Cancel</Button>
					</FormActions>
				</Form>
				<QuickReplies items={quickReplyItems} visible onClick={() => {}} />
			</Section>

			<Section title="Media & Cards">
				<Group gap="sm">
					<Image src={demoImage} alt="Preview" fluid style={{ width: 140 }} />
					<ImageList list={imageList} />
				</Group>
				<Carousel dots loop>
					{imageList.map((item) => (
						<Image key={item.id} src={item.src} alt={item.id} fluid />
					))}
				</Carousel>
				{file ? <FileCard file={file} extension="txt" /> : <ChatText>File API unavailable.</ChatText>}
				<MediaObject picUrl={demoImage} title="Media Object" meta="Compact summary" />
				<Card>
					<CardContent>
						<CardText>Card text content inside ChatUI Card.</CardText>
					</CardContent>
				</Card>
			</Section>

			<Section title="Commerce">
				<Goods {...goodsList[0]!} />
				<OrderObject title="Order Summary" list={orderItems} count={2} />
				<Group gap="sm">
					<Coupon
						name="Launch Coupon"
						value={15}
						condition="Orders over $60"
						endAt={Date.now() + 86_400_000}
						btnText="Apply"
					/>
					<RedPacket name="Welcome Pack" value={20} desc="Valid for 24h" endAt={Date.now() + 86_400_000} />
					<MultiRedPacket name="Team Bonus" count={8} total={88} btnText="Claim" />
				</Group>
				<Group gap="sm" align="center">
					<Price price={89} currency="$" />
					<Price price={129} currency="$" original />
				</Group>
			</Section>

			<Section title="Feedback & Status">
				<Notice content="System maintenance planned tonight." />
				<Tips primary icon="info">
					Remember to save your settings.
				</Tips>
				<Quote author="Bot Layer">Command bus ready.</Quote>
				<RateActions upTitle="Helpful" downTitle="Not useful" onClick={(value) => setRating(value)} />
				{rating && <StatusBadge text={`Rated: ${rating}`} />}
				<Progress value={68} status="active" />
				<MessageStatus status="sent" />
				<Loading tip="Loading" />
				<Skeleton w="100%" h={12} />
				<Countdown targetDate={Date.now() + 15_000} />
			</Section>

			<Section title="Navigation & Lists">
				<Navbar title="ChatUI Navbar" desc="Navigation sample" />
				<Tabs index={0} scrollable>
					<Tab label="Overview">Overview tab content</Tab>
					<Tab label="Details">Details tab content</Tab>
					<Tab label="Logs">Logs tab content</Tab>
				</Tabs>
				<Stepper current={1}>
					<Step title="Connect" desc="Create bot instance" />
					<Step title="Configure" desc="Set up adapters" />
					<Step title="Run" desc="Start chat flow" />
				</Stepper>
				<List bordered>
					<ListItem content="ChatUI List Item" />
					<ListItem content="Another entry" />
				</List>
				<KvList>
					<KvItem title="Platform" desc="Active adapter">
						KOOK
					</KvItem>
					<KvItem title="Latency" desc="Last ping">
						32ms
					</KvItem>
				</KvList>
				<ScrollView
					data={scrollItems}
					scrollX
					renderItem={(item) => (
						<div key={item} style={{ padding: '0 8px' }}>
							<Tag color="primary">{item}</Tag>
						</div>
					)}
				/>
				<ScrollGrid wrap>
					{scrollItems.map((item) => (
						<Tag key={item} color="primary">
							{item}
						</Tag>
					))}
				</ScrollGrid>
				<Filter options={filterOptions} value={filterValue} onChange={(value) => setFilterValue(value)} />
			</Section>

			<Section title="Rich & Motion">
				<RichText content={richHtml} />
				<Typing />
				<TypingBubble content="TypingBubble simulates typewriter output." />
				<Think>Thinking mode</Think>
				<Time date={new Date()} />
			</Section>

			<Section title="Overlays & Empty">
				<Group gap="sm">
					<Button color="primary" onClick={() => setModalOpen(true)}>
						Open Modal
					</Button>
					<Button variant="outline" onClick={() => setPopupOpen(true)}>
						Open Popup
					</Button>
				</Group>
				<Empty type="search" tip="No results" desc="Try another keyword." />
			</Section>

			<Modal
				active={modalOpen}
				title="ChatUI Modal"
				onClose={() => setModalOpen(false)}
				actions={[
					{
						label: 'Close',
						onClick: () => setModalOpen(false),
					},
				]}
			>
				<CardText>Modal content area.</CardText>
			</Modal>

			<Popup
				active={popupOpen}
				title="ChatUI Popup"
				onClose={() => setPopupOpen(false)}
				actions={[
					{
						label: 'Dismiss',
						onClick: () => setPopupOpen(false),
					},
				]}
			>
				<CardText>Popup content area.</CardText>
			</Popup>
		</>
	)
}
