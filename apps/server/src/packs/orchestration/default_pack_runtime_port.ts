import type { RuntimeClockProjectionSnapshot } from '../../app/runtime/runtime_clock_projection.js';
import type { PackRuntimePort } from '../../app/services/pack_runtime_ports.js';
import type { PackRuntimeHost } from '../../core/pack_runtime_host.js';
import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { WorldPack } from '../manifest/loader.js';
import { renderNarrativeTemplate } from '../../template_engine/frontends/narrative/resolver.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../../template_engine/frontends/narrative/variable_context.js';
import type { PermissionContext } from '../../permission/types.js';

export class DefaultPackRuntimePort implements PackRuntimePort {
  constructor(private readonly host: PackRuntimeHost) {}

  getPackId(): string {
    return this.host.getPackId();
  }

  getCurrentTick(): bigint {
    return this.host.getCurrentTick();
  }

  getCurrentRevision(): bigint {
    return this.host.getCurrentRevision();
  }

  getPack(): WorldPack {
    return this.host.getPack();
  }

  resolvePackVariables(
    template: string,
    permission?: PermissionContext,
    actorState?: Record<string, unknown> | null
  ): string {
    const pack = this.host.getPack();
    const layers = [
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord({
          metadata: pack?.metadata ?? null,
          variables: pack?.variables ?? {}
        }),
        alias_values: normalizePromptVariableRecord({
          ...(pack?.variables ?? {}),
          world_name: pack?.metadata.name ?? '',
          pack_name: pack?.metadata.name ?? '',
          pack_id: pack?.metadata.id ?? ''
        }),
        metadata: {
          source_label: 'simulation-pack',
          trusted: true
        }
      }),
      createPromptVariableLayer({
        namespace: 'runtime',
        values: normalizePromptVariableRecord({
          current_tick: this.getCurrentTick().toString()
        }),
        alias_values: normalizePromptVariableRecord({
          current_tick: this.getCurrentTick().toString()
        }),
        metadata: {
          source_label: 'simulation-runtime',
          trusted: true
        }
      })
    ];

    if (actorState && Object.keys(actorState).length > 0) {
      layers.push(
        createPromptVariableLayer({
          namespace: 'actor_state',
          values: normalizePromptVariableRecord(actorState),
          alias_values: normalizePromptVariableRecord(actorState),
          metadata: {
            source_label: 'simulation-actor-state',
            trusted: true
          }
        })
      );
    }

    const variableContext = createPromptVariableContext({ layers });

    return renderNarrativeTemplate({
      template,
      variableContext,
      permission,
      templateSource: 'simulation.resolvePackVariables'
    }).text;
  }

  getStepTicks(): bigint {
    return this.host.getStepTicks();
  }

  getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot {
    return this.host.getRuntimeSpeedSnapshot();
  }

  setRuntimeSpeedOverride(stepTicks: bigint): void {
    this.host.setRuntimeSpeedOverride(stepTicks);
  }

  clearRuntimeSpeedOverride(): void {
    this.host.clearRuntimeSpeedOverride();
  }

  getAllTimes(): unknown {
    return this.host.getAllTimes();
  }

  async step(amount?: bigint): Promise<void> {
    await this.host.step(amount);
  }

  getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null {
    return this.host.getPackSlotDeclarations();
  }

  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void {
    this.host.applyClockProjection(snapshot);
  }
}
