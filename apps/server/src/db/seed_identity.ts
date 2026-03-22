import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type PolicySeed = {
  effect: 'allow' | 'deny';
  subject_id?: string | null;
  subject_type?: string | null;
  resource: string;
  action: string;
  field: string;
  priority: number;
};

type IdentityBindingSeed = {
  identity_id: string;
  agent_id?: string | null;
  atmosphere_node_id?: string | null;
  role: 'active' | 'atmosphere';
  status: 'active' | 'inactive' | 'expired';
  expires_at?: bigint | null;
};

type AtmosphereNodeSeed = {
  id: string;
  name: string;
  owner_id: string;
  expires_at?: bigint | null;
};

const ensureIdentity = async (id: string, type: string, name: string) => {
  const now = BigInt(Date.now());
  await prisma.identity.upsert({
    where: { id },
    update: { type, name, updated_at: now },
    create: {
      id,
      type,
      name,
      provider: 'm2',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  });
};

const ensureAgent = async (id: string, name: string, type: string) => {
  const now = BigInt(Date.now());
  await prisma.agent.upsert({
    where: { id },
    update: {
      name,
      type,
      updated_at: now
    },
    create: {
      id,
      name,
      type,
      created_at: now,
      updated_at: now
    }
  });
};

const ensurePolicy = async (policy: PolicySeed) => {
  const existing = await prisma.policy.findFirst({
    where: {
      effect: policy.effect,
      subject_id: policy.subject_id ?? null,
      subject_type: policy.subject_type ?? null,
      resource: policy.resource,
      action: policy.action,
      field: policy.field
    }
  });
  if (existing) {
    return;
  }

  const now = BigInt(Date.now());
  await prisma.policy.create({
    data: {
      effect: policy.effect,
      subject_id: policy.subject_id ?? null,
      subject_type: policy.subject_type ?? null,
      resource: policy.resource,
      action: policy.action,
      field: policy.field,
      conditions: undefined,
      priority: policy.priority,
      created_at: now,
      updated_at: now
    }
  });
};

const ensureAtmosphereNode = async (node: AtmosphereNodeSeed) => {
  await prisma.atmosphereNode.upsert({
    where: { id: node.id },
    update: {
      name: node.name,
      owner_id: node.owner_id,
      expires_at: node.expires_at ?? null
    },
    create: {
      id: node.id,
      name: node.name,
      owner_id: node.owner_id,
      expires_at: node.expires_at ?? null,
      created_at: BigInt(Date.now())
    }
  });
};

const ensureIdentityBinding = async (binding: IdentityBindingSeed) => {
  const existing = await prisma.identityNodeBinding.findFirst({
    where: {
      identity_id: binding.identity_id,
      agent_id: binding.agent_id ?? null,
      atmosphere_node_id: binding.atmosphere_node_id ?? null,
      role: binding.role
    }
  });
  if (existing) {
    return;
  }

  const now = BigInt(Date.now());
  await prisma.identityNodeBinding.create({
    data: {
      identity_id: binding.identity_id,
      agent_id: binding.agent_id ?? null,
      atmosphere_node_id: binding.atmosphere_node_id ?? null,
      role: binding.role,
      status: binding.status,
      expires_at: binding.expires_at ?? undefined,
      created_at: now,
      updated_at: now
    }
  });
};

async function main() {
  console.log('--- 开始注入身份与策略 ---');

  await ensureIdentity('system', 'system', 'System');
  await ensureIdentity('user-001', 'user', 'User-001');
  await ensureIdentity('agent-001', 'agent', 'Agent-001');
  await ensureIdentity('agent-002', 'agent', 'Agent-002');
  await ensureIdentity('agent-003', 'agent', 'Agent-003');

  await ensureAgent('agent-001', 'Agent-001', 'active');
  await ensureAgent('agent-002', 'Agent-002', 'active');
  await ensureAgent('agent-003', 'Agent-003', 'active');

  const policies: PolicySeed[] = [
    { effect: 'allow', subject_id: 'system', resource: 'social_post', action: 'read', field: '*', priority: 100 },
    { effect: 'allow', subject_id: 'system', resource: 'social_post', action: 'write', field: '*', priority: 100 },
    { effect: 'deny', subject_type: 'user', resource: 'social_post', action: 'read', field: 'content.private.*', priority: 200 },
    { effect: 'allow', subject_type: 'user', resource: 'social_post', action: 'read', field: 'content.private.preview', priority: 100 },
    { effect: 'deny', subject_type: 'agent', resource: 'social_post', action: 'read', field: 'content.private.*', priority: 200 },
    { effect: 'allow', subject_type: 'user', resource: 'social_post', action: 'read', field: 'id', priority: 10 },
    { effect: 'allow', subject_type: 'user', resource: 'social_post', action: 'read', field: 'author_id', priority: 10 },
    { effect: 'allow', subject_type: 'user', resource: 'social_post', action: 'read', field: 'content', priority: 10 },
    { effect: 'allow', subject_type: 'user', resource: 'social_post', action: 'read', field: 'created_at', priority: 10 },
    { effect: 'allow', subject_type: 'user', resource: 'social_post', action: 'write', field: 'content', priority: 10 },
    { effect: 'allow', subject_type: 'agent', resource: 'social_post', action: 'read', field: 'id', priority: 10 },
    { effect: 'allow', subject_type: 'agent', resource: 'social_post', action: 'read', field: 'author_id', priority: 10 },
    { effect: 'allow', subject_type: 'agent', resource: 'social_post', action: 'read', field: 'content', priority: 10 },
    { effect: 'allow', subject_type: 'agent', resource: 'social_post', action: 'read', field: 'created_at', priority: 10 },
    { effect: 'allow', subject_type: 'agent', resource: 'social_post', action: 'write', field: 'content', priority: 10 }
  ];

  for (const policy of policies) {
    await ensurePolicy(policy);
  }

  const now = BigInt(Date.now());
  const atmosphereNodes: AtmosphereNodeSeed[] = [
    {
      id: 'atm-001',
      name: 'Agent-001 Sockpuppet',
      owner_id: 'agent-001',
      expires_at: now + 86_400n
    }
  ];

  for (const node of atmosphereNodes) {
    await ensureAtmosphereNode(node);
  }

  const bindings: IdentityBindingSeed[] = [
    {
      identity_id: 'agent-001',
      agent_id: 'agent-001',
      role: 'active',
      status: 'active'
    },
    {
      identity_id: 'agent-002',
      agent_id: 'agent-002',
      role: 'active',
      status: 'active'
    },
    {
      identity_id: 'agent-003',
      agent_id: 'agent-003',
      role: 'active',
      status: 'active'
    },
    {
      identity_id: 'user-001',
      atmosphere_node_id: 'atm-001',
      role: 'atmosphere',
      status: 'active',
      expires_at: now + 86_400n
    }
  ];

  for (const binding of bindings) {
    await ensureIdentityBinding(binding);
  }

  console.log('--- 身份与策略注入完成 ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
