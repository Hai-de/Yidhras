import fs from 'fs'
import path from 'path'

import { createLogger } from '../utils/logger.js'
import { resetRuntimeConfigCache } from './runtime_config.js'

const logger = createLogger('config-watcher')

export interface ConfigWatcher {
  close(): void
}

const DEBOUNCE_MS = 500

const getConfigDir = (): string | null => {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const configDir = path.join(dir, 'data', 'configw', 'conf.d')
    if (fs.existsSync(configDir) && fs.statSync(configDir).isDirectory()) {
      return configDir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

interface FileSnapshot {
  mtimeMs: number
  size: number
}

/**
 * Start watching the conf.d/ directory for config changes.
 * Uses mtime+size snapshots to skip no-op events (e.g. duplicate fs.watch firings).
 * On actual content change, resets the runtime config cache.
 * Granular per-domain cache invalidation is a future optimization;
 * currently the full cache is invalidated.
 */
export const startConfigWatcher = (): ConfigWatcher | null => {
  const configDir = getConfigDir()

  if (!configDir) {
    return null
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const fileSnapshots = new Map<string, FileSnapshot>()

  const handleChange = (eventType: string, filename: string | null): void => {
    if (!filename || (!filename.endsWith('.yaml') && !filename.endsWith('.yml'))) {
      return
    }

    const filePath = path.join(configDir, filename)
    let stat: fs.Stats | null = null
    try {
      stat = fs.statSync(filePath)
    } catch {
      // file deleted or inaccessible — treat as change
      fileSnapshots.delete(filePath)
    }

    if (stat) {
      const prev = fileSnapshots.get(filePath)
      if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) {
        // No actual change — skip
        return
      }
      fileSnapshots.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size })
    }

    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      try {
        resetRuntimeConfigCache()
        logger.info(`配置文件已变更 (${eventType}: ${filename})，运行时配置缓存已重置`)
        logger.info('注意: 仅 safe 级别配置项支持热重载。非 safe 级别配置需重启服务生效。')
      } catch (err) {
        logger.warn(`配置重载时出错: ${String(err)}`)
      }
    }, DEBOUNCE_MS)
  }

  const watcher = fs.watch(configDir, { persistent: false }, handleChange)

  logger.info(`配置文件监听已启动: ${configDir}`)

  return {
    close: (): void => {
      watcher.close()
      if (timer) {
        clearTimeout(timer)
      }
      fileSnapshots.clear()
      logger.info('配置文件监听已关闭')
    }
  }
}
