import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { useCompactionPrompt } from './compactionPromptState.js'
import styles from './CompactionPrompt.module.css'

/**
 * 压缩进行中的阻塞提示（v2.9.1）。
 *
 * 用户明确要求：**无论自动压缩还是手动压缩**，压缩时都要弹一个
 * 「压缩中，请不要关闭」的弹窗，并说明「压缩时和压缩后短期卡顿属于正常现象」。
 *
 * 设计要点：
 * - 挂在应用根部（App.tsx），自动压缩发生在发送请求链路里，那时用户可能已经离开设置页；
 * - 不可关闭、不可点遮罩消失：压缩是写本地库的中间态，中途关掉会让用户以为没生效；
 * - 明确写出「本地记录不会丢」，缓解用户对压缩的恐惧（这是被压缩功能劝退的主因）；
 * - 顺带把「卡顿是正常现象」写进弹窗，避免用户以为卡死而强杀进程。
 */
export const CompactionPrompt = () => {
  const t = useTranslate()
  const active = useCompactionPrompt((state) => state.active)
  const origin = useCompactionPrompt((state) => state.origin)
  const open = active > 0

  // 压缩期间锁住页面滚动，避免弹窗底下还在滚动导致重排
  useEffect(() => {
    if (!open) {
      return
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <Modal
      title={t(origin === 'manual' ? 'compactionPromptTitleManual' : 'compactionPromptTitleAuto')}
      className={styles.modal}
      // 故意不提供关闭：压缩中途关掉会让人以为没生效
      onClose={() => {}}
    >
      <div className={styles.body}>
        <div className={styles.spinner} aria-hidden>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
        <p className={styles.text}>{t('compactionPromptKeepOpen')}</p>
        <p className={styles.text}>{t('compactionPromptLagHint')}</p>
        <p className={styles.safe}>{t('compactionPromptSafeHint')}</p>
      </div>
    </Modal>
  )
}
