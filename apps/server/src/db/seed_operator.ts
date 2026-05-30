import 'dotenv/config'

import fs from 'fs'
import path from 'path'
import * as YAML from 'yaml'

import { resolveWorkspaceRoot } from '../config/loader.js'
import { hashPassword } from '../operator/auth/password.js'
import {
  DEFAULT_BCRYPT_ROUNDS,
  PACK_BINDING_TYPE,
  ROOT_OPERATOR_USERNAME
} from '../operator/constants.js'
import { createLogger } from '../utils/logger.js'
import { createPrismaClient } from './client.js'

const logger = createLogger('seed-operator')

const prisma = createPrismaClient()

function discoverPackIds(packsDir: string): string[] {
  if (!fs.existsSync(packsDir)) return []

  const packIds: string[] = []

  for (const entry of fs.readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    for (const configFile of ['pack.yaml', 'pack.yml']) {
      const filePath = path.join(packsDir, entry.name, configFile)
      if (!fs.existsSync(filePath)) continue

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: YAML parse return
        const parsed = YAML.parse(content) as Record<string, unknown>
        const metadata = parsed['metadata']
        if (metadata && typeof metadata === 'object' && 'id' in metadata) {
          const id = metadata.id
          if (typeof id === 'string') {
            packIds.push(id)
          }
        }
      } catch {
        logger.warn(`Failed to parse ${filePath}, skipping`)
      }
      break
    }
  }

  return packIds
}

async function main() {
  const rootPassword = process.env['ROOT_PASSWORD'] || 'changeme-root-password'
  const now = BigInt(Date.now())

  // 1. 创建 root Identity
  const identity = await prisma.identity.upsert({
    where: { id: 'identity-root' },
    update: { type: 'user', name: ROOT_OPERATOR_USERNAME, updated_at: now },
    create: {
      id: 'identity-root',
      type: 'user',
      name: ROOT_OPERATOR_USERNAME,
      provider: 'operator',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  })

  logger.info(`Identity created: ${identity.id}`)

  // 2. 创建 root Operator
  const passwordHash = await hashPassword(rootPassword, DEFAULT_BCRYPT_ROUNDS)

  const operator = await prisma.operator.upsert({
    where: { username: ROOT_OPERATOR_USERNAME },
    update: {
      password_hash: passwordHash,
      is_root: true,
      status: 'active',
      updated_at: now
    },
    create: {
      identity_id: identity.id,
      username: ROOT_OPERATOR_USERNAME,
      password_hash: passwordHash,
      is_root: true,
      status: 'active',
      display_name: 'Root Operator',
      created_at: now,
      updated_at: now
    }
  })

  logger.info(`Operator created: ${operator.id} (${operator.username})`)

  // 3. 为所有已发现的 pack 创建 root 的 OperatorPackBinding
  const workspaceRoot = resolveWorkspaceRoot()
  const packsDir = path.join(workspaceRoot, 'data', 'world_packs')
  const discoveredPackIds = discoverPackIds(packsDir)

  logger.info(`Discovered pack IDs: ${discoveredPackIds.join(', ') || '(none)'}`)

  for (const packId of discoveredPackIds) {
    const existingBinding = await prisma.operatorPackBinding.findUnique({
      where: {
        operator_id_pack_id: {
          operator_id: operator.id,
          pack_id: packId
        }
      }
    })

    if (!existingBinding) {
      await prisma.operatorPackBinding.create({
        data: {
          operator_id: operator.id,
          pack_id: packId,
          binding_type: PACK_BINDING_TYPE.OWNER,
          bound_at: now,
          bound_by: null,
          created_at: now
        }
      })

      logger.info(`PackBinding created: ${operator.id} -> ${packId} (owner)`)
    } else {
      logger.info(`PackBinding already exists: ${operator.id} -> ${packId}`)
    }
  }

  // 4. 为示例 Agent 创建 root 的 IdentityNodeBinding（仅当 Agent 已存在时）
  const defaultAgentId = 'agent-001'
  const agentExists = await prisma.agent.findUnique({ where: { id: defaultAgentId } })
  if (agentExists) {
    const existingAgentBinding = await prisma.identityNodeBinding.findFirst({
      where: {
        identity_id: identity.id,
        agent_id: defaultAgentId,
        role: 'active'
      }
    })

    if (!existingAgentBinding) {
      await prisma.identityNodeBinding.create({
        data: {
          identity_id: identity.id,
          agent_id: defaultAgentId,
          role: 'active',
          status: 'active',
          created_at: now,
          updated_at: now
        }
      })

      logger.info(`AgentBinding created: ${identity.id} -> ${defaultAgentId} (active)`)
    } else {
      logger.info(`AgentBinding already exists: ${identity.id} -> ${defaultAgentId}`)
    }
  }

  logger.info('Operator seed complete')
}

main()
  .catch((e: unknown) => {
    logger.error('Operator seed error', { error: e instanceof Error ? e.message : String(e) })
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
