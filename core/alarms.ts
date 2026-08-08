// 定时任务调度原语（core 层仅提供 create/clear/监听注册，不含业务逻辑）
// 业务处理器由 background.ts 注册（可依赖 services），保持单向依赖 background → services → core

export const ALARM = {
  WEBDAV_BACKUP: 'mp_webdav_backup',
  /** MoviePilot 服务端备份（MoviePilotTools 插件） */
  MP_BACKUP: 'mp_server_backup',
  COOKIE_UA_UPDATE: 'mp_cookie_ua_update',
  SITE_AUTO_OPEN: 'mp_site_auto_open',
  /** 自动打开站点后，延迟关闭标签页（一次性） */
  SITE_AUTO_OPEN_CLOSE: 'mp_site_auto_open_close',
} as const

export type AlarmName = (typeof ALARM)[keyof typeof ALARM]

const handlers = new Map<string, () => void | Promise<void>>()

/** 按配置重建闹钟：先清除，enabled 且周期 > 0 时创建 */
export async function reconfigureAlarm(
  name: AlarmName,
  enabled: boolean,
  periodInMinutes: number,
): Promise<void> {
  await chrome.alarms.clear(name)
  if (enabled && periodInMinutes > 0) {
    chrome.alarms.create(name, { periodInMinutes, delayInMinutes: periodInMinutes })
  }
}

/** 注册闹钟业务处理器（background 调用） */
export function registerAlarmHandler(name: AlarmName, handler: () => void | Promise<void>): void {
  handlers.set(name, handler)
}

/** background 启动时调用一次：监听闹钟并分发到已注册处理器 */
export function initAlarms(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    const handler = handlers.get(alarm.name)
    if (handler) Promise.resolve(handler()).catch((e) => console.error('[MoviePilot] alarm error:', alarm.name, e))
  })
}
