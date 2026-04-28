import type {
  ConfigBackup,
  ConfigBackupPolicy
} from '@yidhras/contracts'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { readYamlFileIfExists, resolveWorkspaceRoot } from '../../config/loader.js'
import { createLogger } from '../../utils/logger.js'

const logger = createLogger('config-backup')

const BACKUP_METADATA_FILE = 'backups.json'
const CONFIGW_RELATIVE_PATH = path.join('data', 'configw')

const FALLBACK_POLICY: ConfigBackupPolicy = {
  enabled: true,
  directory: 'data/backups/config',
  retention: {
    max_count: 20,
    max_age_days: 30
  }
}

const loadBackupPolicy = (workspaceRoot: string): ConfigBackupPolicy => {
  const configPath = path.join(workspaceRoot, 'data', 'configw', 'conf.d', 'backup.yaml')
  const raw = readYamlFileIfExists(configPath)

  if (Object.keys(raw).length === 0 || !raw.backup || typeof raw.backup !== 'object') {
    return FALLBACK_POLICY
  }

  const cfg = raw.backup as Record<string, unknown>
  return {
    enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : FALLBACK_POLICY.enabled,
    directory: typeof cfg.directory === 'string' ? cfg.directory : FALLBACK_POLICY.directory,
    retention: {
      max_count:
        typeof (cfg.retention as Record<string, unknown> | undefined)?.max_count === 'number'
          ? ((cfg.retention as Record<string, unknown>).max_count as number)
          : FALLBACK_POLICY.retention.max_count,
      max_age_days:
        typeof (cfg.retention as Record<string, unknown> | undefined)?.max_age_days === 'number'
          ? ((cfg.retention as Record<string, unknown>).max_age_days as number)
          : FALLBACK_POLICY.retention.max_age_days
    }
  }
}

interface BackupMetaEntry {
  id: string
  name: string | null
  created_at: string
  size_bytes: number
}

interface BackupMetadata {
  backups: BackupMetaEntry[]
}

const getBackupDir = (workspaceRoot: string): string => {
  const policy = loadBackupPolicy(workspaceRoot)
  return path.join(workspaceRoot, policy.directory)
}

const getMetadataPath = (backupDir: string): string => {
  return path.join(backupDir, BACKUP_METADATA_FILE)
}

const readMetadata = (backupDir: string): BackupMetadata => {
  const metaPath = getMetadataPath(backupDir)
  if (!fs.existsSync(metaPath)) {
    return { backups: [] }
  }

  try {
    const raw = fs.readFileSync(metaPath, 'utf-8')
    return JSON.parse(raw) as BackupMetadata
  } catch {
    return { backups: [] }
  }
}

const writeMetadata = (backupDir: string, metadata: BackupMetadata): void => {
  fs.mkdirSync(backupDir, { recursive: true })
  fs.writeFileSync(getMetadataPath(backupDir), JSON.stringify(metadata, null, 2), 'utf-8')
}

const generateBackupId = (): string => {
  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-')
  return `backup-${ts}`
}

const archiveDirectory = (
  sourceDir: string,
  archivePath: string,
  cwd: string
): Promise<number> => {
  return new Promise((resolve, reject) => {
    const sourceRelative = path.relative(cwd, sourceDir)
    const archiveRelative = path.relative(cwd, archivePath)

    const tar = spawn('tar', ['-czf', archiveRelative, sourceRelative], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    tar.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    tar.on('close', code => {
      if (code !== 0) {
        reject(new Error(`tar exit code ${code}: ${stderr}`))
        return
      }

      try {
        const stat = fs.statSync(archivePath)
        resolve(stat.size)
      } catch (err) {
        reject(err)
      }
    })

    tar.on('error', reject)
  })
}

const extractArchive = (
  archivePath: string,
  targetDir: string,
  cwd: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', archivePath, '-C', targetDir], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    tar.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    tar.on('close', code => {
      if (code !== 0) {
        reject(new Error(`tar exit code ${code}: ${stderr}`))
        return
      }
      resolve()
    })

    tar.on('error', reject)
  })
}

export const createConfigBackup = async (
  name?: string
): Promise<ConfigBackup> => {
  const workspaceRoot = resolveWorkspaceRoot()
  const backupDir = getBackupDir(workspaceRoot)
  const sourceDir = path.join(workspaceRoot, CONFIGW_RELATIVE_PATH)

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`配置目录不存在: ${sourceDir}`)
  }

  const id = generateBackupId()
  const archivePath = path.join(backupDir, `${id}.tar.gz`)

  fs.mkdirSync(backupDir, { recursive: true })

  const sizeBytes = await archiveDirectory(sourceDir, archivePath, workspaceRoot)

  const entry: BackupMetaEntry = {
    id,
    name: name ?? null,
    created_at: new Date().toISOString(),
    size_bytes: sizeBytes
  }

  const metadata = readMetadata(backupDir)
  metadata.backups.unshift(entry)
  writeMetadata(backupDir, metadata)

  logger.info(`配置备份已创建: ${id} (${(sizeBytes / 1024).toFixed(1)} KB)${name ? ` [${name}]` : ''}`)

  return {
    id: entry.id,
    name: entry.name,
    created_at: entry.created_at,
    size_bytes: entry.size_bytes,
    path: archivePath
  }
}

export const listConfigBackups = (limit = 20, offset = 0): ConfigBackup[] => {
  const workspaceRoot = resolveWorkspaceRoot()
  const backupDir = getBackupDir(workspaceRoot)
  const metadata = readMetadata(backupDir)

  return metadata.backups.slice(offset, offset + limit).map(entry => ({
    id: entry.id,
    name: entry.name,
    created_at: entry.created_at,
    size_bytes: entry.size_bytes,
    path: path.join(backupDir, `${entry.id}.tar.gz`)
  }))
}

export const getConfigBackup = (id: string): ConfigBackup | null => {
  const workspaceRoot = resolveWorkspaceRoot()
  const backupDir = getBackupDir(workspaceRoot)
  const metadata = readMetadata(backupDir)
  const entry = metadata.backups.find(b => b.id === id)

  if (!entry) {
    return null
  }

  return {
    id: entry.id,
    name: entry.name,
    created_at: entry.created_at,
    size_bytes: entry.size_bytes,
    path: path.join(backupDir, `${entry.id}.tar.gz`)
  }
}

export const deleteConfigBackup = (id: string): boolean => {
  const workspaceRoot = resolveWorkspaceRoot()
  const backupDir = getBackupDir(workspaceRoot)
  const metadata = readMetadata(backupDir)
  const index = metadata.backups.findIndex(b => b.id === id)

  if (index === -1) {
    return false
  }

  const archivePath = path.join(backupDir, `${id}.tar.gz`)
  if (fs.existsSync(archivePath)) {
    fs.unlinkSync(archivePath)
  }

  metadata.backups.splice(index, 1)
  writeMetadata(backupDir, metadata)

  logger.info(`配置备份已删除: ${id}`)
  return true
}

export const restoreConfigBackup = async (
  id: string,
  force = false
): Promise<void> => {
  const workspaceRoot = resolveWorkspaceRoot()
  const backupDir = getBackupDir(workspaceRoot)
  const archivePath = path.join(backupDir, `${id}.tar.gz`)

  if (!fs.existsSync(archivePath)) {
    throw new Error(`备份文件不存在: ${archivePath}`)
  }

  const targetDir = path.join(workspaceRoot, CONFIGW_RELATIVE_PATH)

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 && !force) {
    throw new Error(
      `目标目录非空: ${targetDir}。使用 --force 强制覆盖。`
    )
  }

  // If force-mode, clear target first
  if (force && fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true })
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true })

  await extractArchive(archivePath, path.dirname(targetDir), workspaceRoot)

  logger.info(`配置已从备份恢复: ${id}`)
}

export const getBackupPolicy = (): ConfigBackupPolicy => {
  const workspaceRoot = resolveWorkspaceRoot()
  return loadBackupPolicy(workspaceRoot)
}

export const applyRetentionPolicy = (): number => {
  const workspaceRoot = resolveWorkspaceRoot()
  const backupDir = getBackupDir(workspaceRoot)
  const metadata = readMetadata(backupDir)
  const policy = loadBackupPolicy(workspaceRoot)
  let removed = 0

  if (!policy.enabled) {
    return 0
  }

  // Apply max_count
  if (metadata.backups.length > policy.retention.max_count) {
    const toRemove = metadata.backups.slice(policy.retention.max_count)
    for (const entry of toRemove) {
      const archivePath = path.join(backupDir, `${entry.id}.tar.gz`)
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath)
      }
      removed++
    }
    metadata.backups = metadata.backups.slice(0, policy.retention.max_count)
  }

  // Apply max_age_days
  const cutoff = Date.now() - policy.retention.max_age_days * 24 * 60 * 60 * 1000
  const remaining: BackupMetaEntry[] = []
  for (const entry of metadata.backups) {
    const createdAt = new Date(entry.created_at).getTime()
    if (createdAt < cutoff) {
      const archivePath = path.join(backupDir, `${entry.id}.tar.gz`)
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath)
      }
      removed++
    } else {
      remaining.push(entry)
    }
  }
  metadata.backups = remaining

  writeMetadata(backupDir, metadata)

  if (removed > 0) {
    logger.info(`保留策略清理: 已移除 ${removed} 个过期备份`)
  }

  return removed
}
