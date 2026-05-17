<template>
  <div class="flex min-h-screen items-center justify-center bg-yd-app px-4">
    <div class="w-full max-w-sm rounded-sm border border-yd-border-muted bg-yd-panel p-8">
      <h1 class="text-lg font-semibold text-yd-text-primary yd-font-mono">Yidhras</h1>
      <p class="mt-2 text-xs text-yd-text-muted yd-font-mono uppercase tracking-[0.12em]">Operator login</p>

      <form class="mt-6 space-y-4" @submit.prevent="handleLogin">
        <div>
          <label class="block text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono" for="username">
            Username
          </label>
          <input
            id="username"
            v-model="username"
            type="text"
            class="mt-1 w-full rounded-sm border border-yd-border-muted bg-yd-app px-3 py-2 text-sm text-yd-text-primary focus:border-yd-state-accent focus:outline-none"
            autocomplete="username"
          />
        </div>

        <div>
          <label class="block text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono" for="password">
            Password
          </label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="mt-1 w-full rounded-sm border border-yd-border-muted bg-yd-app px-3 py-2 text-sm text-yd-text-primary focus:border-yd-state-accent focus:outline-none"
            autocomplete="current-password"
          />
        </div>

        <p v-if="errorMessage" class="text-xs text-yd-state-danger">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-sm bg-yd-state-accent px-4 py-2 text-sm font-semibold text-yd-text-inverse transition-opacity disabled:opacity-50"
        >
          {{ isSubmitting ? 'Logging in...' : 'Login' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
import { requestApiData } from '../../lib/http/client'

definePageMeta({
  layout: false
})

const auth = useAuthStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)

const handleLogin = async () => {
  errorMessage.value = null
  isSubmitting.value = true

  try {
    const result = await requestApiData<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value
      }
    })

    auth.setToken(result.token)
    await router.push('/packs')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Login failed'
  } finally {
    isSubmitting.value = false
  }
}

if (auth.isAuthenticated) {
  router.replace('/packs')
}
</script>
