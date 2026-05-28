import type { AppContext } from '../src/app/context.js';
import type { ConversationStore } from '../src/conversation/store.js';
import type { PackStorageAdapter } from '../src/packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../src/packs/storage/SchedulerStorageAdapter.js';

/**
 * AppContext 的测试变体，允许在测试中直接替换特定服务。
 * 仅用于测试夹具，生产代码不可用。
 *
 * 替代当前 (context as { schedulerStorage: ... }).schedulerStorage = adapter 模式。
 */
export interface MutableTestContext extends AppContext {
  schedulerStorage: SchedulerStorageAdapter;
  packStorageAdapter: PackStorageAdapter;
  conversationStore: ConversationStore;
}
