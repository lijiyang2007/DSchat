import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronRightOutline14, IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import styles from './SettingsPage.module.css'

/** 当前打开的设置页，后打开的在末尾；Esc 只关最上层 */
const openPages: object[] = []

/**
 * 全屏设置页外壳：占满整个视口，顶部返回栏 + 可滚动内容区。
 * 移动端体验优先，桌面端也保持一致（不再用居中弹窗）。
 */
export const SettingsPage = ({
  title,
  subtitle,
  onBack,
  onClose,
  children,
  footer,
  backLabel,
}: {
  title: ReactNode
  subtitle?: ReactNode
  /** 子页返回上一级；主页面不传 */
  onBack?: () => void
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  backLabel?: string
}) => {
  const t = useTranslate()

  useEffect(() => {
    const token = {}
    openPages.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openPages.at(-1) !== token) {
        return
      }
      if (onBack) {
        onBack()
      } else {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openPages.splice(openPages.indexOf(token), 1)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onBack, onClose])

  return createPortal(
    <div className={styles.page} role="dialog" aria-modal="true" aria-label={backLabel ?? t('settings')}>
      <header className={styles.header}>
        {onBack ? (
          <button type="button" className={styles.back} onClick={onBack} aria-label={t('back')}>
            <span className={styles.backIcon}>
              <IconChevronRightOutline14 />
            </span>
            {backLabel ?? t('back')}
          </button>
        ) : (
          <span className={styles.headerSpacer} />
        )}
        <IconButton
          size="m"
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={onClose}
        />
      </header>
      <div className={styles.body}>
        <div className={styles.bodyInner}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          <div className={styles.content}>{children}</div>
        </div>
      </div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </div>,
    document.body
  )
}

/** 主页面上的垂直入口行：标题 + 说明 + 右箭头 */
export const SettingsEntry = ({
  icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon?: ReactNode
  title: string
  description?: string
  badge?: ReactNode
  onClick: () => void
}) => (
  <button type="button" className={styles.entry} onClick={onClick}>
    {icon ? <span className={styles.entryIcon}>{icon}</span> : null}
    <span className={styles.entryText}>
      <span className={styles.entryTitle}>{title}</span>
      {description ? <span className={styles.entryDesc}>{description}</span> : null}
    </span>
    {badge ? <span className={styles.entryBadge}>{badge}</span> : null}
    <span className={styles.entryArrow}>
      <IconChevronRightOutline14 />
    </span>
  </button>
)
