// 设置页逐级返回的逻辑检查（复刻 store 状态机，不依赖浏览器）
// 运行：node scripts/check-settings-nav.mjs

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${detail}`)
  }
}

// 复刻 settingsDialogState 的状态与行为
const createStore = () => {
  const state = { open: false, section: 'general', targeted: false, page: null }
  return {
    get: () => state,
    openSettings: (section) =>
      Object.assign(state, { open: true, section, targeted: true, page: section }),
    openSettingsHome: () =>
      Object.assign(state, { open: true, targeted: false, page: null }),
    openSection: (section) => Object.assign(state, { page: section }),
    closeSection: () => Object.assign(state, { page: null }),
    close: () => Object.assign(state, { open: false, targeted: false, page: null }),
    // handleSettingsBack 的语义
    handleBack: () => {
      if (!state.open) return false
      if (state.page !== null) {
        Object.assign(state, { page: null })
        return true
      }
      return false
    },
  }
}

// 复刻 backButton 对设置分支的处理
const pressBack = (store) => {
  const s = store.get()
  if (!s.open) return 'not-handled'
  if (store.handleBack()) return 'went-to-list'
  store.close()
  return 'closed'
}

console.log('从子页进入后按返回')
{
  const store = createStore()
  store.openSettings('model')
  check('初始在模型子页', store.get().page === 'model')
  check('第一次返回 → 回到列表', pressBack(store) === 'went-to-list')
  check('设置仍打开', store.get().open === true)
  check('当前在主页', store.get().page === null)
  check('第二次返回 → 关闭设置', pressBack(store) === 'closed')
  check('设置已关闭', store.get().open === false)
}

console.log('\n从列表页进入后按返回')
{
  const store = createStore()
  store.openSettingsHome()
  check('初始在主页', store.get().page === null)
  check('第一次返回 → 直接关闭', pressBack(store) === 'closed')
}

console.log('\n子页之间切换不累积层级')
{
  const store = createStore()
  store.openSettingsHome()
  store.openSection('general')
  store.openSection('memory')
  check('当前在记忆子页', store.get().page === 'memory')
  check('返回一次 → 列表', pressBack(store) === 'went-to-list')
  check('再返回 → 关闭', pressBack(store) === 'closed')
}

console.log('\n未打开设置时返回键不拦截')
{
  const store = createStore()
  check('未打开时返回 false', store.handleBack() === false)
  check('pressBack 不处理', pressBack(store) === 'not-handled')
}

console.log('\n关闭设置会清空子页状态')
{
  const store = createStore()
  store.openSettings('data')
  store.close()
  check('close 后 page 为 null', store.get().page === null)
  check('close 后 open 为 false', store.get().open === false)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
