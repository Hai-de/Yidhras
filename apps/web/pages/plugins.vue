<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Plugin Management"
      title="Pack-local plugins"
      description="Inspect discovered plugins, review capability risk, confirm imports, and control enabled/disabled state for the active world pack."
      :freshness="pluginManagementPage.isFetching.value ? 'Refreshing plugin inventory' : 'Plugin inventory loaded'"
    >
      <template #actions>
        <AppButton :disabled="pluginManagementPage.isFetching.value" @click="pluginManagementPage.refresh()">
          Refresh Plugins
        </AppButton>
      </template>
    </WorkspacePageHeader>

    <WorkspaceStatusBanner
      v-if="pluginManagementPage.errorMessage.value"
      title="Plugin inventory error"
      :message="pluginManagementPage.errorMessage.value"
    />

    <WorkspaceStatusBanner
      v-else-if="pluginManagementPage.successMessage.value"
      tone="info"
      title="Operation completed"
      :message="pluginManagementPage.successMessage.value"
    />

    <WorkspaceStatusBanner
      v-if="pluginManagementPage.operationErrorMessage.value"
      title="Plugin operation failed"
      :message="pluginManagementPage.operationErrorMessage.value"
    />

    <WorkspaceStatusBanner
      v-if="pluginManagementPage.acknowledgementRequired.value"
      tone="warning"
      title="Acknowledgement required"
      message="Enabling this plugin requires explicit acknowledgement of the canonical trust lecture before the backend will accept the enable operation."
    />

    <div class="grid xl:grid-cols-[0.9fr,1.1fr]" :style="sectionGridStyle">
      <OverviewListCard
        title="Plugins"
        subtitle="Current pack-local plugin installations for the active world pack."
        :items="pluginManagementPage.pluginListItems.value"
        empty-message="No plugin installations found for the active world pack."
        @select="pluginManagementPage.selectInstallation"
      />

      <AppPanel>
        <WorkspaceSectionHeader
          title="Plugin Detail"
          subtitle="Selected plugin manifest state, lifecycle, granted capabilities, and trust posture."
        />

        <div v-if="pluginManagementPage.selectedInstallation.value" class="grid gap-4 px-5 py-5">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Plugin</div>
              <div class="mt-2 text-sm font-semibold text-yd-text-primary yd-font-mono">
                {{ pluginManagementPage.selectedInstallation.value.plugin_id }}
              </div>
              <div class="mt-1 text-xs text-yd-text-secondary">
                version {{ pluginManagementPage.selectedInstallation.value.version }}
              </div>
            </div>
            <div class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4">
              <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Lifecycle</div>
              <div class="mt-2 text-sm font-semibold text-yd-text-primary yd-font-mono">
                {{ pluginManagementPage.selectedInstallation.value.lifecycle_state }}
              </div>
              <div class="mt-1 text-xs text-yd-text-secondary">
                trust {{ pluginManagementPage.selectedInstallation.value.trust_mode }} · risk {{ pluginManagementPage.selectedRiskLevel.value }}
              </div>
            </div>
          </div>

          <div class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Operator Actions</div>
                <div class="mt-2 text-sm text-yd-text-secondary">
                  Next action:
                  <span class="font-medium text-yd-text-primary">{{ pluginManagementPage.selectedActionLabel.value ?? 'No operator action available' }}</span>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <AppButton
                  variant="secondary"
                  :disabled="!pluginManagementPage.canSubmitConfirm.value"
                  @click="pluginManagementPage.confirmSelectedInstallation()"
                >
                  Confirm Import
                </AppButton>
                <AppButton
                  :disabled="!pluginManagementPage.canSubmitEnable.value"
                  @click="pluginManagementPage.enableSelectedInstallation()"
                >
                  Enable Plugin
                </AppButton>
                <AppButton
                  variant="secondary"
                  :disabled="!pluginManagementPage.canSubmitDisable.value"
                  @click="pluginManagementPage.disableSelectedInstallation()"
                >
                  Disable Plugin
                </AppButton>
              </div>
            </div>
          </div>

          <div
            v-if="pluginManagementPage.selectedRequiresConfirmation.value"
            class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4"
          >
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Confirm Import</div>
            <div class="mt-2 text-sm leading-6 text-yd-text-secondary">
              Import confirmation chooses which requested capabilities will be granted to this installation. You can confirm with a reduced grant set if you want the plugin to stay partially inert.
            </div>
            <div class="mt-4 grid gap-2">
              <label
                v-for="capability in pluginManagementPage.selectedCapabilities.value"
                :key="`capability:${capability}`"
                class="flex items-center gap-3 rounded-sm border border-yd-border-muted px-3 py-2 text-sm text-yd-text-secondary"
              >
                <input
                  :checked="pluginManagementPage.selectedGrantedCapabilities.value.includes(capability)"
                  type="checkbox"
                  @change="pluginManagementPage.setCapabilityGranted(capability, ($event.target as HTMLInputElement).checked)"
                >
                <span class="yd-font-mono text-xs text-yd-text-primary">{{ capability }}</span>
              </label>
            </div>
            <div class="mt-3 text-xs text-yd-text-secondary">
              {{ pluginManagementPage.selectedCapabilitiesSummary.value }}
            </div>
          </div>

          <div
            v-if="pluginManagementPage.selectedCanEnable.value && pluginManagementPage.enableWarning.value.enabled"
            class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4"
          >
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Enable Acknowledgement</div>
            <div class="mt-2 text-sm leading-6 text-yd-text-secondary">
              Explicit enable must respect the runtime warning policy exposed by the backend.
            </div>

            <div class="mt-4 rounded-sm border border-yd-border-muted bg-yd-app px-4 py-4">
              <pre class="whitespace-pre-wrap text-xs leading-6 text-yd-text-secondary yd-font-mono">{{ pluginManagementPage.acknowledgementReminderText.value }}</pre>
            </div>

            <label
              v-if="pluginManagementPage.enableWarning.value.require_acknowledgement"
              class="mt-4 flex items-start gap-3 rounded-sm border border-yd-border-muted px-3 py-3 text-sm text-yd-text-secondary"
            >
              <input
                :checked="pluginManagementPage.enableAcknowledged.value"
                type="checkbox"
                class="mt-1"
                @change="pluginManagementPage.setEnableAcknowledged(($event.target as HTMLInputElement).checked)"
              >
              <span>
                I acknowledge the canonical plugin enable warning and want to enable this trusted plugin for the active pack.
              </span>
            </label>

            <div v-else class="mt-4 text-xs text-yd-text-secondary">
              Current runtime config shows the warning text but does not require acknowledgement before enable.
            </div>
          </div>

          <div class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Capabilities</div>
            <div class="mt-3 grid gap-2 md:grid-cols-2">
              <div>
                <div class="text-xs font-medium text-yd-text-primary">Requested</div>
                <ul class="mt-2 space-y-1 text-xs text-yd-text-secondary yd-font-mono">
                  <li v-for="capability in pluginManagementPage.selectedInstallation.value.requested_capabilities" :key="`requested:${capability}`">
                    {{ capability }}
                  </li>
                </ul>
              </div>
              <div>
                <div class="text-xs font-medium text-yd-text-primary">Granted</div>
                <ul class="mt-2 space-y-1 text-xs text-yd-text-secondary yd-font-mono">
                  <li v-for="capability in pluginManagementPage.selectedInstallation.value.granted_capabilities" :key="`granted:${capability}`">
                    {{ capability }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div class="rounded-sm border border-yd-border-muted bg-yd-panel px-4 py-4">
            <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">Operator Note</div>
            <div class="mt-2 text-sm leading-6 text-yd-text-secondary">
              This GUI now uses the same confirm / enable / disable backend APIs as CLI and server routes. Import still requires explicit confirmation, and explicit enable still respects
              <span class="yd-font-mono text-xs text-yd-text-primary">plugins.enable_warning.enabled</span>
              and
              <span class="yd-font-mono text-xs text-yd-text-primary">plugins.enable_warning.require_acknowledgement</span>.
            </div>
          </div>
        </div>

        <div v-else class="px-5 py-5">
          <WorkspaceEmptyState
            title="No plugin selected"
            description="Select a plugin installation from the left list to inspect lifecycle state and capability risk."
          />
        </div>
      </AppPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import AppButton from '../components/ui/AppButton.vue'
import AppPanel from '../components/ui/AppPanel.vue'
import OverviewListCard from '../features/overview/components/OverviewListCard.vue'
import { usePluginManagementPage } from '../features/plugins/composables/usePluginManagementPage'
import WorkspaceEmptyState from '../features/shared/components/WorkspaceEmptyState.vue'
import WorkspacePageHeader from '../features/shared/components/WorkspacePageHeader.vue'
import WorkspaceSectionHeader from '../features/shared/components/WorkspaceSectionHeader.vue'
import WorkspaceStatusBanner from '../features/shared/components/WorkspaceStatusBanner.vue'

const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const

const sectionGridStyle = {
  gap: 'var(--yd-layout-card-gap)'
} as const

const pluginManagementPage = usePluginManagementPage()

onMounted(() => {
  void pluginManagementPage.refresh()
})
</script>
