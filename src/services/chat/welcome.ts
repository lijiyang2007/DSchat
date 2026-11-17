import type { TranslationKey } from '../../i18n/index.js'

/**
 * 新对话欢迎语候选。
 * 进入新对话时随机挑一条，同一个新对话页面内保持不变，换一次新对话才重新抽。
 */
export const WELCOME_GREETING_KEYS = [
  'welcomeGreetingComeBackAnytime',
  'welcomeGreetingHowCanIHelp',
  'welcomeGreetingLetsChat',
  'welcomeGreetingWhatToday',
  'welcomeGreetingWhereToStart',
  'welcomeGreetingWhatCanIDo',
] as const satisfies readonly TranslationKey[]

export type WelcomeGreetingKey = (typeof WELCOME_GREETING_KEYS)[number]

/** 随机挑一条欢迎语；允许注入 random 便于测试 */
export const pickWelcomeGreeting = (random: () => number = Math.random): WelcomeGreetingKey => {
  const index = Math.floor(random() * WELCOME_GREETING_KEYS.length)
  const safeIndex = Number.isFinite(index)
    ? Math.min(WELCOME_GREETING_KEYS.length - 1, Math.max(0, index))
    : 0
  return WELCOME_GREETING_KEYS[safeIndex]
}
