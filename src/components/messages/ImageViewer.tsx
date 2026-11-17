import { useEffect } from 'react'
import { create } from 'zustand'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import styles from './ImageViewer.module.css'

type ViewerState = {
  open: boolean
  url: string | null
  name: string
}

export const useImageViewer = create<ViewerState>(() => ({
  open: false,
  url: null,
  name: '',
}))

/** 打开全屏图片查看器；url 为对象的本地地址，调用方负责它的生命周期 */
export const openImageViewer = (url: string, name: string) =>
  useImageViewer.setState({ open: true, url, name })

export const closeImageViewer = () =>
  useImageViewer.setState({ open: false, url: null, name: '' })

/**
 * 全屏图片查看：附件在应用内放大查看，不跳出 WebView。
 * 点击遮罩或按 Esc / 系统返回键关闭。
 */
export const ImageViewer = () => {
  const t = useTranslate()
  const { open, url, name } = useImageViewer()

  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImageViewer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open || !url) {
    return null
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={closeImageViewer}
    >
      <button
        type="button"
        className={styles.close}
        aria-label={t('close')}
        onClick={closeImageViewer}
      >
        <IconCloseOutline16 />
      </button>
      <img className={styles.image} src={url} alt={name} onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
