import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 单个会话导出时的文件名：带上会话标题，便于在文件管理器里认出来 */
const sessionFileName = (date: Date, title: string) => {
  const clean = title
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .slice(0, 40)
  return `deepseek_session-${formatDate(date)}${clean ? `-${clean}` : ''}.zip`
}

/** 导出全部会话为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
    return { name: backupFileName(now), blob }
  })

/**
 * 只导出单个会话（v2.7.7）。
 *
 * 产物与「导出全部」同格式（manifest + sessions/<id>.json + index.json + files/），
 * 所以导入时照样能延续会话内容，不需要单独的导入分支。
 */
export const exportSession = (sessionId: string): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const { sessions, sessionCache } = useChatStore.getState()
    const summary = sessions.find((item) => item.id === sessionId)
    const session = Object.hasOwn(sessionCache, sessionId)
      ? sessionCache[sessionId]
      : await db.loadSession(sessionId)
    if (!session) {
      throw new Error(`History session disappeared during export: ${sessionId}`)
    }
    const merged = summary ? { ...session, ...summary } : session
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive([merged])
    return { name: sessionFileName(now, merged.title ?? ''), blob }
  })

/**
 * 导入历史对话（v2.8.7 起是**合并**，不再覆盖）。
 *
 * 先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；通过后从 ZIP 流式写入暂存，
 * 成功才把新会话并进本地库。**原有会话与附件全部保留**，导入的会话排在列表最前。
 * 返回本次导入的会话数。
 */
export const importHistory = (
  file: File,
  onProgress?: (sessions: number) => void
): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    const rootPrefix = await checkArchiveFormat(file)
    return replaceHistory(() => importArchive(file, onProgress, rootPrefix), 'merge')
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {}, 'replace')
  })
