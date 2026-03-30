import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- 开始注入种子数据 ---');

  const now = 0n;

  // 1. 创建管理员 Agent
  await prisma.agent.upsert({
    where: { id: 'admin-001' },
    update: {},
    create: {
      id: 'admin-001',
      name: '系统架构师 (Architect)',
      type: 'active',
      snr: 1.0,
      is_pinned: true,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.agent.upsert({
    where: { id: 'admin-002' },
    update: {},
    create: {
      id: 'admin-002',
      name: '安全监察官 (Overseer)',
      type: 'active',
      snr: 0.9,
      is_pinned: true,
      created_at: now,
      updated_at: now
    }
  });

  // 2. 创建普通人 Agent
  await prisma.agent.upsert({
    where: { id: 'agent-001' },
    update: {},
    create: {
      id: 'agent-001',
      name: '公民 Alpha',
      type: 'active',
      snr: 0.5,
      is_pinned: false,
      created_at: now,
      updated_at: now
    }
  });

  await prisma.agent.upsert({
    where: { id: 'agent-002' },
    update: {},
    create: {
      id: 'agent-002',
      name: '公民 Beta',
      type: 'active',
      snr: 0.5,
      is_pinned: false,
      created_at: now,
      updated_at: now
    }
  });

  // 3. 建立初始关系 (L2)
  await prisma.relationship.createMany({
    data: [
      { from_id: 'admin-001', to_id: 'admin-002', type: 'colleague', weight: 1.0, created_at: now, updated_at: now },
      { from_id: 'admin-002', to_id: 'admin-001', type: 'colleague', weight: 1.0, created_at: now, updated_at: now },
      { from_id: 'admin-001', to_id: 'agent-001', type: 'monitor', weight: 0.8, created_at: now, updated_at: now },
      { from_id: 'admin-002', to_id: 'agent-002', type: 'monitor', weight: 0.8, created_at: now, updated_at: now }
    ]
  });

  console.log('--- 种子数据注入完成 ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
