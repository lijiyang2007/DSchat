import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconArchiveOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinOutline16,
  IconThinkOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import {
  renameSession,
  selectSession,
  setSessionArchived,
  setSessionPinned,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { closeMobileSider } from './mobileSiderState.js'
import { ContextUsage } from '../settings/ContextUsage.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  onUnarchive,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
  /** 归档页里显示「移回对话历史」而不是「归档」 */
  onUnarchive?: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active, menuOpen && styles.menuOpen)}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>
        {session.pinned ? (
          <span className={styles.pinMark} aria-hidden>
            <IconPinOutline16 />
          </span>
        ) : null}
        {displayTitle}
      </div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          onOpenChange={setMenuOpen}
          options={[
            // 上下文用量放第一项：这是用户最常想看的，其余是管理动作
            {
              key: 'usage',
              label: t('sessionItemMenuContextUsage'),
              icon: <IconThinkOutline16 />,
              onSelect: () => {
                setMenuOpen(false)
                setUsageOpen(true)
              },
            },
            {
              key: 'pin',
              label: t(session.pinned ? 'sessionItemMenuUnpinOption' : 'sessionItemMenuPinOption'),
              icon: <IconPinOutline16 />,
              onSelect: () => {
                setMenuOpen(false)
                setSessionPinned(session.id, !session.pinned)
              },
            },
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => {
                setMenuOpen(false)
                setEditing(true)
              },
            },
            onUnarchive
              ? {
                  key: 'unarchive',
                  label: t('sessionItemMenuUnarchiveOption'),
                  icon: <IconArchiveOutline16 />,
                  onSelect: () => {
                    setMenuOpen(false)
                    onUnarchive()
                  },
                }
              : {
                  key: 'archive',
                  label: t('sessionItemMenuArchiveOption'),
                  icon: <IconArchiveOutline16 />,
                  onSelect: () => {
                    setMenuOpen(false)
                    setSessionArchived(session.id, true)
                  },
                },
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          {({ open, toggle }) => (
            <IconButton
              icon={<IconEllipsisOutline16 />}
              aria-label={t('more')}
              aria-expanded={open}
              onClick={toggle}
            />
          )}
        </Menu>
      </div>
      {usageOpen ? (
        <div onClick={(event) => event.stopPropagation()}>
          <Modal
            title={t('sessionItemMenuContextUsage')}
            closable
            onClose={() => setUsageOpen(false)}
            footer={
              <Button variant="outlined" size="m" onClick={() => setUsageOpen(false)}>
                {t('close')}
              </Button>
            }
          >
            <ContextUsage sessionId={session.id} />
          </Modal>
        </div>
      ) : null}
    </div>
  )
})
