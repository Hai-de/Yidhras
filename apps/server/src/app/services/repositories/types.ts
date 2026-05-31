export type { EntityRepositories } from './entity_repos.js';
export type { PluginRepositories } from './plugin_repos.js';
export type { WorkflowRepositories } from './workflow_repos.js';

import type { EntityRepositories } from './entity_repos.js';
import type { PluginRepositories } from './plugin_repos.js';
import type { WorkflowRepositories } from './workflow_repos.js';

/**
 * @deprecated 使用具体子接口（EntityRepositories、WorkflowRepositories、
 * PluginRepositories）代替。此组合接口将在 Phase 17 移除。
 */
export interface Repositories extends EntityRepositories, WorkflowRepositories, PluginRepositories {}
