import { PrismaClient } from '@prisma/client'

import { hashPassword } from '../operator/auth/password.js'
import {
  DEFAULT_BCRYPT_ROUNDS,
  PACK_BINDING_TYPE,
  ROOT_OPERATOR_USERNAME
} from '../operator/constants.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('seed-operator')

const prisma = new PrismaClient()

async function main() {
  const rootPassword = process.env.ROOT_PASSWORD || 'changeme-root-password'
  const defaultPackId = process.env.WORLD_PACK || 'example_pack'
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

  // 3. 为默认 pack 创建 root 的 OperatorPackBinding
  const existingBinding = await prisma.operatorPackBinding.findUnique({
    where: {
      operator_id_pack_id: {
        operator_id: operator.id,
        pack_id: defaultPackId
      }
    }
  })

  if (!existingBinding) {
    await prisma.operatorPackBinding.create({
      data: {
        operator_id: operator.id,
        pack_id: defaultPackId,
        binding_type: PACK_BINDING_TYPE.OWNER,
        bound_at: now,
        bound_by: null,
        created_at: now
      }
    })

    logger.info(`PackBinding created: ${operator.id} -> ${defaultPackId} (owner)`)
  } else {
    logger.info(`PackBinding already exists: ${operator.id} -> ${defaultPackId}`)
  }

  // 4. 为示例 Agent 创建 root 的 IdentityNodeBinding
  const defaultAgentId = 'agent-001'
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

  logger.info('Operator seed complete')
}

main()
  .catch(e => {
    logger.error('Operator seed error', { error: e instanceof Error ? e.message : String(e) })
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
