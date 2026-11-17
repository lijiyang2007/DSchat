import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseFill14,
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconSortOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed, useSettings } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettingsHome } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import {
  setSessionSort,
  sortSessions,
  toggleGroupCollapsed,
  useCollapsedGroups,
  useSessionSort,
  type SessionSort,
} from './sessionSortState.js'
import styles from './Sider.module.css'

/** 账号入口：把 API Key 打码后当作身份展示，没有 Key 时显示本地账户 */
const maskAccount = (apiKey: string | null): string => {
  const key = (apiKey ?? '').trim()
  if (!key) {
    return ''
  }
  if (key.length <= 10) {
    return `${key.slice(0, 2)}****${key.slice(-2)}`
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

/**
 * 展开的侧边栏：顶部搜索框、新建对话、按时间分组的会话目录、底部账号与设置。
 * 移动端放在抽屉里，收起按钮关闭抽屉。
 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const apiKey = useSettings((state) => state.apiKey)
  const sort = useSessionSort((state) => state.sort)
  const collapsedKeys = useCollapsedGroups((state) => state.keys)
  const [now, setNow] = useState(Date.now)
  const ordered = useMemo(() => sortSessions(sessions, sort), [sessions, sort])
  // 只有按更新时间排时才按日期分组；换成标题/创建时间后日期不再单调，分组会碎成好几段
  const groups = useMemo(
    () =>
      sort === 'updatedAt'
        ? groupSessions(ordered, now, t)
        : [{ key: 'all', label: t('sessionGroupAll'), sessions: ordered }],
    [ordered, now, t, sort]
  )
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [query, setQuery] = useState('')
  // 搜索只按标题匹配：消息全文在库里，逐条读太慢，标题命中已能覆盖大多数场景
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return null
    }
    return ordered.filter((session) => session.title.toLowerCase().includes(keyword))
  }, [query, ordered])

  const sortOptions: { key: SessionSort; labelKey: 'sessionSortByUpdated' | 'sessionSortByCreated' | 'sessionSortByTitle' }[] = [
    { key: 'updatedAt', labelKey: 'sessionSortByUpdated' },
    { key: 'createdAt', labelKey: 'sessionSortByCreated' },
    { key: 'title', labelKey: 'sessionSortByTitle' },
  ]

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const account = maskAccount(apiKey)
  const accountLabel = account || t('accountLocalLabel')

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>
          <IconSearchOutline16 />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder={t('sessionSearchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('sessionSearchPlaceholder')}
        />
        {query ? (
          <button
            type="button"
            className={styles.searchClear}
            aria-label={t('sessionSearchClear')}
            onClick={() => setQuery('')}
          >
            <IconCloseFill14 />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {filtered ? (
            filtered.length > 0 ? (
              filtered.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                />
              ))
            ) : (
              <div className={styles.searchEmpty}>{t('sessionSearchNoResult')}</div>
            )
          ) : (
            groups.map((group, index) => {
              const collapsed = collapsedKeys.includes(group.key)
              return (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>
                  <button
                    type="button"
                    className={styles.sectionToggle}
                    aria-expanded={!collapsed}
                    aria-label={t(collapsed ? 'sessionGroupExpand' : 'sessionGroupCollapse', {
                      label: group.label,
                    })}
                    onClick={() => toggleGroupCollapsed(group.key)}
                  >
                    <span className={styles.sectionChevron}>
                      {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
                    </span>
                    <span className={styles.sectionLabel}>{group.label}</span>
                  </button>
                  {index === 0 ? (
                    <Menu
                      options={sortOptions.map((option) => ({
                        key: option.key,
                        label: t(option.labelKey),
                        icon: option.key === sort ? <IconCheckOutline16 /> : <span />,
                        onSelect: () => setSessionSort(option.key),
                      }))}
                    >
                      {({ toggle, open }) => (
                        <button
                          type="button"
                          className={styles.sortButton}
                          aria-label={t('sessionSortLabel')}
                          aria-expanded={open}
                          onClick={toggle}
                        >
                          <IconSortOutline16 />
                        </button>
                      )}
                    </Menu>
                  ) : null}
                </div>
                {collapsed
                  ? null
                  : group.sessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        active={session.id === activeId}
                        onDelete={() => setDeleting(session)}
                      />
                    ))}
              </div>
              )
            })
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.account}
          onClick={() => {
            openSettingsHome()
            if (mobile) {
              closeMobileSider()
            }
          }}
        >
          <span className={styles.avatar} aria-hidden>
            {accountLabel.slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.accountLabel}>{accountLabel}</span>
        </button>
        <div className={styles.bottomActions}>
          <IconButton
            size="m"
            tone="tertiary"
            icon={<IconSettingsOutline16 />}
            tooltip={t('settings')}
            tooltipPlacement="top"
            onClick={openSettingsHome}
          />
          <IconButton
            size="m"
            tone="tertiary"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="top"
            onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
          />
        </div>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：位于主内容层下方，主内容右滑时丝滑显露 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  return (
    <div className={clsx(styles.drawer, open && styles.drawerOpen)} aria-hidden={!open}>
      <Sider mobile />
    </div>
  )
}
