import type { OperatorContext } from '../../../operator/auth/types.js'
import type { DataContext } from '../../context.js'

export interface PackQueryHandler {
  readonly capability_key: string
  resolve(
    context: DataContext,
    packId: string,
    payload: unknown,
    operator: OperatorContext
  ): unknown
}

export class PackQueryHandlerRegistry {
  private readonly handlers = new Map<string, PackQueryHandler>()

  register(handler: PackQueryHandler): void {
    this.handlers.set(handler.capability_key, handler)
  }

  find(capabilityKey: string): PackQueryHandler | undefined {
    return this.handlers.get(capabilityKey)
  }

  keys(): string[] {
    return Array.from(this.handlers.keys())
  }
}
