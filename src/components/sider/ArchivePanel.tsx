import { useMemo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconArchiveOutline16 } from '../base/icons.js'
import { useChatStore, setSessionArchived } from '../../services/chat/store.js'
import { SessionItem } from './SessionItem.js'
import styles from './ArchivePanel.module.css'

/**
 * 归档页：列出所有被归档的对话，可以把它们移回对话历史。
 * 归档只是打标记，会话和其中的文件都还在本地，恢复后消息完整保留。
 */
export const ArchivePanel = ({
  onDelete,
  onClose,
}: {
  onDelete: (id: string) => void
  onClose: () => void
}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  // 按归档时间倒序：最近归档的排最前面
  const archived = useMemo(
    () =>
      sessions
        .filter((session) => session.archived)
        .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt)),
    [sessions]
  )

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden>
            <IconArchiveOutline16 />
          </span>
          <span role="heading" className={styles.title}>
            {t('archivePanelTitle')}
          </span>
        </div>
        <button type="button" className={styles.close} onClick={onClose}>
          {t('back')}
        </button>
      </div>
      <div className={styles.hint}>{t('archivePanelHint')}</div>
      <div className={styles.list}>
        {archived.length === 0 ? (
          <div className={styles.empty}>{t('archivePanelEmpty')}</div>
        ) : (
          archived.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeId}
              onDelete={() => onDelete(session.id)}
              onUnarchive={() => setSessionArchived(session.id, false)}
            />
          ))
        )}
      </div>
    </div>
  )
}
