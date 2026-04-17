<template>
  <div class="flex min-h-full flex-col" :style="pageLayoutStyle">
    <WorkspacePageHeader
      eyebrow="Plugin Management"
      title="Pack-local plugins"
      description="Inspect discovered plugins, review capability risk, confirm imports, and control enabled/disabled state for the active world pack."
      :freshness="pluginManagementPage.isFetching.value ? 'Refreshing plugin inventory' : 'Plugin inventory loaded'"
    >
      <template #actions>
        <AppButton @click="pluginManagementPage.refresh()">
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
      v-if="pluginManagementPage.acknowledgementRequired.value"
      tone="warning"
      title="Acknowledgement required"
      message="Enabling a trusted plugin requires acknowledgement of the runtime warning contract. GUI confirmation flow is the next implementation step; current page highlights the requirement and current risk surface."
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
              Every explicit enable operation remains subject to the trust lecture acknowledgement flow. Current management page focuses on read visibility and lifecycle inspection; confirm/enable/disable action wiring can build directly on the plugin APIs already exposed by the backend.
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
