import { useTranslate } from '../../i18n/index.js'
import { SPONSOR_NAMES } from '../../services/sponsors.js'
import { IconHeartOutline16 } from '../base/icons.js'
import { SettingsGroup } from './SettingsPage.js'
import styles from './Settings.module.css'

/**
 * 感谢赞助页：设置最底层的入口进来。
 * 名单来自 services/sponsors.ts，按赞助先后一条一条往下排。
 */
export const SponsorSettings = () => {
  const t = useTranslate()
  return (
    <SettingsGroup label={t('sponsorPageTitle')}>
      <div className={styles.cell}>
        <div className={styles.sponsorIntro}>{t('sponsorPageIntro')}</div>
        {SPONSOR_NAMES.length > 0 ? (
          <ul className={styles.sponsorList}>
            {SPONSOR_NAMES.map((name) => (
              <li key={name} className={styles.sponsorItem}>
                <span className={styles.sponsorIcon}>
                  <IconHeartOutline16 />
                </span>
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.description}>{t('sponsorEmpty')}</div>
        )}
      </div>
    </SettingsGroup>
  )
}
