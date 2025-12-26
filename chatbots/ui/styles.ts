import { useComputedColorScheme } from '@mantine/core'
import { useEffect } from 'react'

import chatuiCss from '@chatui/core/dist/index.css?raw'

const STYLE_ID = 'pluxel-chatui-styles'

let injected = false

function applyChatUiColorScheme(value: string | null | undefined): void {
	if (typeof document === 'undefined') return
	const scheme = value === 'dark' ? 'dark' : 'light'
	const root = document.documentElement
	if (root.getAttribute('data-color-scheme') !== scheme) {
		root.setAttribute('data-color-scheme', scheme)
	}
}

export function ensureChatUiStyles(): void {
	if (typeof document === 'undefined') return
	if (injected) return
	if (document.getElementById(STYLE_ID)) {
		injected = true
		return
	}
	const style = document.createElement('style')
	style.id = STYLE_ID
	style.textContent = chatuiCss
	document.head.appendChild(style)
	injected = true
	applyChatUiColorScheme(document.documentElement.getAttribute('data-mantine-color-scheme'))
}

export function useChatUiColorScheme(): void {
	const scheme = useComputedColorScheme('light', { getInitialValueInEffect: true })
	useEffect(() => {
		applyChatUiColorScheme(scheme)
	}, [scheme])
}
