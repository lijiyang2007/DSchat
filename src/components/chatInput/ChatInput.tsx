import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  IconAttachmentOutline22,
  IconCameraOutline22,
  IconGalleryOutline22,
  IconGlobeLanguageOutline14,
  IconPlusOutline18,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import {
  activeProvider,
  matchesRefusalKeyword,
  setModel,
  setSearch,
  useSettings,
} from '../../services/settings.js'
import { accountToken } from '../../services/account.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  // 按钮高亮 = 当前用的是 Pro 模型。思考强度（off/low/high/max）由设置页控制，
  // 本按钮绝不修改强度——只负责在 Pro / Flash 之间切换。
  const model = useSettings((state) => state.model)
  const usingPro = /pro/i.test(model)

  /**
   * 深度思考按钮点击（v2.8.3 起语义变更）：
   * 官方账号 + 官方供应商 → 只在 Pro / Flash 之间切换模型，并提示额度消耗；
   * 不做任何思考强度的改动。用户想调强度请去设置页。
   * 其他供应商不接管，按钮退化为只读展示（不做无意义切换）。
   */
  const onThinkingClick = () => {
    const settings = useSettings.getState()
    const provider = activeProvider(settings)
    const isOfficial = provider.id === 'deepseek-official' || provider.builtin === true
    if (!isOfficial || !accountToken()) {
      showToast({ key: 'thinkingOnlyOfficial' })
      return
    }
    const pro = provider.models.find((m) => m.id === 'deepseek-v4-pro' || /pro/i.test(m.id))
    const flash = provider.models.find((m) => /flash/i.test(m.id))
    if (usingPro) {
      // 当前 Pro → 切回 Flash
      if (flash) {
        setModel(flash.id)
        showToast({ key: 'thinkingSwitchedFlash' })
      }
    } else {
      // 当前 Flash → 切到 Pro
      if (pro) {
        setModel(pro.id)
        showToast({ key: 'thinkingProQuotaHint' })
      }
    }
  }
  const effortLabel = t('thinkingSwitch')
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const [plusOpen, setPlusOpen] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const openPicker = (ref: RefObject<HTMLInputElement>) => {
    if (ensureApiKey()) {
      ref.current?.click()
    }
  }

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory) {
      return
    }
    if (!ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    const prepared = prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    if (useChatStore.getState().importingHistory || voice.status !== 'idle' || !prepared) {
      return
    }
    // 命中本地拒答关键词时无需强制校验主 API Key；文本与上传完成态由提交动作读取最新快照。
    if ((!matchesRefusalKeyword(prepared.text) && !ensureApiKey()) || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    setPlusOpen(false)
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div className={styles.inputHost}>
      <div
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
            placeholder={t(isMobile ? 'chatInputPlaceholderMobile' : 'chatInputPlaceholderChat')}
            rows={2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (
                isMobile &&
                event.button === 0 &&
                document.activeElement !== event.currentTarget
              ) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          <div className={styles.mirror} aria-hidden>
            {`${text}\n`}
          </div>
        </div>
        <div className={styles.functionRow}>
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div className={styles.toggles}>
            <Tooltip content={t('thinkingTooltipPro', { model: usingPro ? 'Pro' : 'Flash' })}>
              <button
                type="button"
                className={clsx(styles.toggle, usingPro && styles.selected)}
                aria-label={t('thinkingTooltipPro', { model: usingPro ? 'Pro' : 'Flash' })}
                aria-pressed={usingPro}
                onClick={onThinkingClick}
              >
                <IconThinkOutline14 />
                <span className={styles.toggleLabel}>{effortLabel}</span>
              </button>
            </Tooltip>
            <Tooltip content={t('deactivatedSearchTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('search')}
                aria-pressed={search}
                onClick={() => {
                  setSearch(!search)
                  showToast({ key: search ? 'searchOffToast' : 'searchOnToast' })
                }}
              >
                <IconGlobeLanguageOutline14 />
                <span className={styles.toggleLabel}>{t('search')}</span>
              </button>
            </Tooltip>
          </div>
          <div className={styles.right}>
            <Tooltip content={t('chatInputMoreActions')}>
              <button
                type="button"
                className={clsx(styles.plusButton, plusOpen && styles.plusOpen)}
                aria-label={t('chatInputMoreActions')}
                aria-expanded={plusOpen}
                disabled={importingHistory}
                onClick={() => setPlusOpen((value) => !value)}
              >
                <span className={styles.plusIcon}>
                  <IconPlusOutline18 />
                </span>
              </button>
            </Tooltip>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => {
                acceptFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
                setPlusOpen(false)
              }}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                acceptFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
                setPlusOpen(false)
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(event) => {
                acceptFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
                setPlusOpen(false)
              }}
            />
            {/* 发送按钮保持在原位；仅语音图标浮在它正上方，其它图标一律不动 */}
            <div className={styles.sendAnchor}>
              {streaming && sessionId ? (
                <button
                  type="button"
                  className={styles.sendButton}
                  aria-label={t('chatInputStopButtonTooltip')}
                  onClick={() => {
                    stopReadAloud()
                    stopReply(sessionId)
                  }}
                >
                  <IconStopFill16 />
                </button>
              ) : (
                <button
                  type="button"
                  className={clsx(styles.sendButton, !canSend && styles.disabled)}
                  aria-label={t('send')}
                  aria-disabled={!canSend}
                  onClick={send}
                >
                  <IconSendOutline16 />
                </button>
              )}
              <div className={styles.voiceFloat}>
                <VoiceButton
                  status={voice.status}
                  disabled={!voice.available}
                  seconds={voice.seconds}
                  onClick={() => {
                    if (
                      voice.status !== 'idle' ||
                      (!useChatStore.getState().importingHistory && ensureApiKey())
                    ) {
                      void voice.toggle()
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        className={clsx(styles.moreTray, plusOpen && styles.moreTrayOpen)}
        aria-hidden={!plusOpen}
      >
        <div className={styles.moreTrayInner}>
          <div className={styles.moreGrid}>
            <button
              type="button"
              className={styles.moreCard}
              tabIndex={plusOpen ? 0 : -1}
              disabled={importingHistory}
              onClick={() => openPicker(cameraInputRef)}
            >
              <IconCameraOutline22 />
              <span>{t('chatInputTakePhoto')}</span>
            </button>
            <button
              type="button"
              className={styles.moreCard}
              tabIndex={plusOpen ? 0 : -1}
              disabled={importingHistory}
              onClick={() => openPicker(galleryInputRef)}
            >
              <IconGalleryOutline22 />
              <span>{t('chatInputPhotoLibrary')}</span>
            </button>
            <button
              type="button"
              className={styles.moreCard}
              tabIndex={plusOpen ? 0 : -1}
              disabled={importingHistory}
              onClick={() => openPicker(fileInputRef)}
            >
              <IconAttachmentOutline22 />
              <span>{t('chatInputPickFiles')}</span>
            </button>
          </div>
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
