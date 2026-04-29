import {
  applyRetentionPolicy,
  createConfigBackup,
  deleteConfigBackup,
  getBackupPolicy,
  getConfigBackup,
  listConfigBackups,
  restoreConfigBackup
} from '../app/services/config_backup.js'

const COMMANDS = ['create', 'list', 'info', 'restore', 'delete', 'policy', 'cleanup'] as const

const printHelp = (): void => {
  console.log(`config:backup — 配置文件备份管理

用法:
  pnpm config:backup create [--name <name>]    创建备份
  pnpm config:backup list [--limit <n>]        列出备份
  pnpm config:backup info <id>                 查看备份详情
  pnpm config:backup restore <id> [--force]    恢复备份
  pnpm config:backup delete <id>               删除备份
  pnpm config:backup policy                     查看保留策略
  pnpm config:backup cleanup                    手动触发保留策略清理
  pnpm config:backup --help                     显示此帮助
`)
}

interface ParsedArgs {
  command?: string
  id?: string
  name?: string
  limit?: number
  force?: boolean
  help?: boolean
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {}

  for (let i = 0; i < argv.length; i++) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    const arg = argv[i]

    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true
        break
      case '--name':
        parsed.name = argv[++i]
        break
      case '--limit':
        parsed.limit = parseInt(argv[++i], 10)
        break
      case '--force':
        parsed.force = true
        break
      default:
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg
        } else if (!arg.startsWith('-') && !parsed.command) {
          parsed.command = arg
        } else if (!arg.startsWith('-') && parsed.command && !parsed.id) {
          parsed.id = arg
        }
    }
  }

  return parsed
}

const runCli = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.command) {
    printHelp()
    process.exitCode = args.help ? 0 : 1
    return
  }

  try {
    switch (args.command) {
      case 'create': {
        const backup = await createConfigBackup(args.name)
        console.log(`备份已创建:`)
        console.log(`  ID:       ${backup.id}`)
        console.log(`  名称:     ${backup.name ?? '(无)'}`)
        console.log(`  大小:     ${(backup.size_bytes / 1024).toFixed(1)} KB`)
        console.log(`  时间:     ${backup.created_at}`)
        break
      }

      case 'list': {
        const backups = listConfigBackups(args.limit ?? 20, 0)
        if (backups.length === 0) {
          console.log('没有找到备份。')
          break
        }

        console.log(`备份列表 (${backups.length} 个):`)
        for (const b of backups) {
          console.log(`  ${b.id}`)
          console.log(`    名称: ${b.name ?? '(无)'}  |  大小: ${(b.size_bytes / 1024).toFixed(1)} KB  |  时间: ${b.created_at}`)
        }
        break
      }

      case 'info': {
        if (!args.id) {
          console.error('错误: 请指定备份 ID (pnpm config:backup info <id>)')
          process.exitCode = 1
          return
        }
        const backup = getConfigBackup(args.id)
        if (!backup) {
          console.error(`错误: 备份 ${args.id} 不存在`)
          process.exitCode = 1
          return
        }
        console.log(`备份详情:`)
        console.log(`  ID:       ${backup.id}`)
        console.log(`  名称:     ${backup.name ?? '(无)'}`)
        console.log(`  大小:     ${(backup.size_bytes / 1024).toFixed(1)} KB`)
        console.log(`  时间:     ${backup.created_at}`)
        console.log(`  路径:     ${backup.path}`)
        break
      }

      case 'restore': {
        if (!args.id) {
          console.error('错误: 请指定备份 ID (pnpm config:backup restore <id>)')
          process.exitCode = 1
          return
        }
        await restoreConfigBackup(args.id, args.force ?? false)
        console.log(`配置已从备份 ${args.id} 恢复`)
        break
      }

      case 'delete': {
        if (!args.id) {
          console.error('错误: 请指定备份 ID (pnpm config:backup delete <id>)')
          process.exitCode = 1
          return
        }
        const deleted = deleteConfigBackup(args.id)
        if (!deleted) {
          console.error(`错误: 备份 ${args.id} 不存在`)
          process.exitCode = 1
          return
        }
        console.log(`备份 ${args.id} 已删除`)
        break
      }

      case 'policy': {
        const policy = getBackupPolicy()
        console.log('备份保留策略:')
        console.log(`  启用:       ${policy.enabled}`)
        console.log(`  目录:       ${policy.directory}`)
        console.log(`  最大数量:   ${policy.retention.max_count}`)
        console.log(`  最大天数:   ${policy.retention.max_age_days}`)
        break
      }

      case 'cleanup': {
        const removed = applyRetentionPolicy()
        console.log(`保留策略清理完成: ${removed} 个过期备份已移除`)
        break
      }

      default:
        console.error(`错误: 未知命令 "${args.command}"。使用 --help 查看帮助。`)
        process.exitCode = 1
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

void runCli()
