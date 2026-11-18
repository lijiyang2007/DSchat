import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconArchiveOutline16, IconPlusOutline18 } from '../base/icons.js'
import {
  addProvider,
  removeProvider,
  setActiveProvider,
  useSettings,
} from '../../services/settings.js'
import { modelLabel } from '../../services/providers.js'
import { Button } from '../base/Button.js'
import styles from './ProviderList.module.css'

/**
 * 供应商列表：
 * 每行一个供应商，右侧「编辑」；自定义供应商额外有「删除」。
 * 点某一行把它设为当前使用的供应商（高亮 + 绿点），
 * 点「添加供应商」会在列表末尾向下追加一格。
 */
export const ProviderList = ({ onEdit }: { onEdit: (id: string) => void }) => {
  const t = useTranslate()
  const providers = useSettings((state) => state.providers)
  const activeId = useSettings((state) => state.activeProviderId)

  return (
    <div className={styles.list}>
      {providers.map((provider) => {
        const active = provider.id === activeId
        const modelCount = provider.models.length
        const currentModel = provider.models.find((item) => item.id === provider.model)
        return (
          <div
            key={provider.id}
            className={clsx(styles.row, active && styles.rowActive)}
            onClick={() => setActiveProvider(provider.id)}
          >
            <div className={styles.info}>
              <div className={styles.titleLine}>
                <span className={styles.name}>{provider.name || t('providerUntitled')}</span>
                {provider.custom ? (
                  <span className={styles.tag}>{t('providerCustomTag')}</span>
                ) : null}
                <span
                  className={clsx(styles.dot, active && styles.dotActive)}
                  aria-hidden
                />
                {active ? (
                  <span className={styles.activeLabel}>{t('providerInUse')}</span>
                ) : null}
              </div>
              <div className={styles.metaLine}>
                {provider.builtin ? (
                  <span className={styles.metaText}>{t('providerOfficialHint')}</span>
                ) : modelCount > 0 ? (
                  <span className={styles.metaText}>
                    {currentModel
                      ? modelLabel(currentModel)
                      : t('providerModelCount', { count: modelCount })}
                  </span>
                ) : (
                  <span className={styles.metaText}>{t('providerNoModel')}</span>
                )}
              </div>
            </div>
            <div className={styles.actions}>
              {/* 官方条目不开放编辑：登录账号即自动可用，模型能力由客户端内置 */}
              {provider.builtin ? (
                <span className={styles.metaText}>{t('providerOfficialLocked')}</span>
              ) : (
                <Button
                  variant="outlined"
                  size="s"
                  onClick={(event) => {
                    event.stopPropagation()
                    onEdit(provider.id)
                  }}
                >
                  {t('providerEdit')}
                </Button>
              )}
              {provider.custom ? (
                <button
                  type="button"
                  className={styles.danger}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeProvider(provider.id)
                  }}
                >
                  {t('delete')}
                </button>
              ) : null}
            </div>
          </div>
        )
      })}

      {/* 追加在末尾：每加一个就向下多一格 */}
      <button
        type="button"
        className={styles.add}
        onClick={() => {
          const id = addProvider()
          onEdit(id)
        }}
      >
        <span className={styles.addIcon}>
          <IconPlusOutline18 />
        </span>
        {t('providerAdd')}
      </button>
    </div>
  )
}

/** 空态：一个模型都没配时给出引导（实际列表至少有内置官方条目） */
export const ProviderEmpty = () => {
  const t = useTranslate()
  return (
    <div className={styles.empty}>
      <IconArchiveOutline16 />
      {t('providerEmpty')}
    </div>
  )
}
