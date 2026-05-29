<template>
  <main class="yd-login-page yd-grid-surface flex min-h-dvh items-center justify-center px-4 py-8">
    <section class="yd-login-shell" aria-labelledby="login-title">
      <div class="yd-login-card yd-panel-surface--elevated yd-tone-info rounded-sm border border-yd-border-muted px-6 py-7 sm:px-8 sm:py-8">
        <header class="yd-separator-bottom pb-5 text-center">
          <h1 id="login-title" class="mt-2 text-2xl font-semibold tracking-tight text-yd-text-primary sm:text-3xl">
            {{ $t('common.app_name') }}
          </h1>
          <p class="mt-3 text-xs uppercase tracking-[0.16em] text-yd-text-secondary yd-font-mono">{{ $t('login.title') }}</p>
        </header>

        <form class="mt-6 space-y-5" @submit.prevent="handleLogin">
          <input
            id="username"
            ref="usernameInput"
            v-model.trim="username"
            type="text"
            :placeholder="$t('login.username')"
            class="yd-login-input h-11 w-full rounded-sm border border-yd-border-muted bg-yd-app px-3 text-sm text-yd-text-primary outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-yd-text-muted focus:border-yd-state-accent focus:bg-yd-panel focus-visible:outline-none"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            :aria-invalid="Boolean(errorMessage)"
            :aria-describedby="errorMessage ? 'login-error' : undefined"
          >

          <input
            id="password"
            ref="passwordInput"
            v-model="password"
            type="password"
            :placeholder="$t('login.password')"
            class="yd-login-input h-11 w-full rounded-sm border border-yd-border-muted bg-yd-app px-3 text-sm text-yd-text-primary outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-yd-text-muted focus:border-yd-state-accent focus:bg-yd-panel focus-visible:outline-none"
            autocomplete="current-password"
            :aria-invalid="Boolean(errorMessage)"
            :aria-describedby="errorMessage ? 'login-error' : undefined"
          >

          <label
            class="yd-login-remember flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-yd-border-muted bg-yd-app px-3 py-2 text-sm text-yd-text-secondary transition-[border-color,background-color,box-shadow,color] duration-150 hover:border-yd-border-strong hover:bg-yd-elevated hover:text-yd-text-primary"
            for="remember"
            :title="$t('login.remember_hint')"
          >
            <input
              id="remember"
              v-model="rememberMe"
              type="checkbox"
              class="h-4 w-4 accent-yd-state-accent"
            >
            <span class="text-[10px] uppercase tracking-[0.12em] yd-font-mono">{{ $t('login.remember_me') }}</span>
          </label>

          <AppAlert v-if="errorMessage" id="login-error" class="yd-login-alert" tone="danger" :title="$t('login.auth_failed')" role="alert">
            {{ errorMessage }}
          </AppAlert>

          <button
            type="submit"
            :disabled="isSubmitting"
            :aria-busy="isSubmitting"
            class="yd-login-submit h-11 border-yd-state-accent/60 text-yd-text-primary active:scale-[0.985]"
          >
            {{ isSubmitting ? $t('login.authenticating') : $t('login.authenticate') }}
          </button>
        </form>
      </div>

      <div class="yd-login-footer mt-4 text-center text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
        <span>v0.0.0</span>
        <LocaleSwitcher />
        <span>Yidhras</span>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import AppAlert from '../components/ui/AppAlert.vue'
import LocaleSwitcher from '../features/shared/components/LocaleSwitcher.vue'
import { ApiClientError, requestApiData } from '../lib/http/client'
import { useAuthStore } from '../stores/auth'

definePageMeta({
  layout: false
})

const { t } = useI18n()
const localePath = useLocalePath()
const auth = useAuthStore()
const router = useRouter()

const username = ref('')
const password = ref('')
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)
const rememberMe = ref(true)
const usernameInput = ref<HTMLInputElement | null>(null)
const passwordInput = ref<HTMLInputElement | null>(null)

const focusUsernameInput = async () => {
  await nextTick()
  usernameInput.value?.focus()
}

const focusPasswordInput = async () => {
  await nextTick()
  passwordInput.value?.focus()
}

const validateLoginForm = async (): Promise<boolean> => {
  if (!username.value) {
    errorMessage.value = t('login.error_username_required')
    await focusUsernameInput()
    return false
  }

  if (!password.value) {
    errorMessage.value = t('login.error_password_required')
    await focusPasswordInput()
    return false
  }

  return true
}

const handleLogin = async () => {
  errorMessage.value = null
  if (isSubmitting.value) return

  const isValid = await validateLoginForm()
  if (!isValid) return

  isSubmitting.value = true

  try {
    const result = await requestApiData<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value
      }
    })

    auth.setToken(result.token, rememberMe.value)
    await router.push(localePath('/packs'))
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      errorMessage.value = t('login.error_invalid_credentials')
      await focusPasswordInput()
    } else if (error instanceof Error) {
      errorMessage.value = error.message
    } else {
      errorMessage.value = t('login.error_login_failed')
    }
  } finally {
    isSubmitting.value = false
  }
}

if (auth.isAuthenticated) {
  router.replace(localePath('/packs'))
}
</script>

<style scoped>
.yd-login-page {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  min-width: 0;
  background-image:
    radial-gradient(
      ellipse at 50% 45%,
      color-mix(in srgb, var(--yd-color-state-accent) 10%, transparent 90%) 0%,
      transparent 46%
    ),
    linear-gradient(to right, var(--yd-grid-line-color) 1px, transparent 1px),
    linear-gradient(to bottom, var(--yd-grid-line-color) 1px, transparent 1px);
}

.yd-login-shell {
  width: 100%;
  max-width: 28rem;
  margin-inline: auto;
}

.yd-login-footer {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.yd-login-card {
  --yd-tone-line-idle: color-mix(in srgb, var(--yd-color-state-accent) 52%, transparent 48%);
  animation: yd-login-enter 260ms ease-out both;
}

.yd-login-input {
  display: block;
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--yd-color-border-muted) 52%, transparent 48%),
    inset 0 -1px 0 color-mix(in srgb, var(--yd-color-border-muted) 52%, transparent 48%),
    inset 2px 0 0 transparent;
}

.yd-login-input:focus,
.yd-login-input:focus-visible {
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--yd-color-border-strong) 62%, transparent 38%),
    inset 0 -1px 0 color-mix(in srgb, var(--yd-color-border-strong) 62%, transparent 38%),
    inset 2px 0 0 color-mix(in srgb, var(--yd-color-state-accent) 72%, transparent 28%),
    0 0 0 1px color-mix(in srgb, var(--yd-color-state-accent) 18%, transparent 82%),
    0 0 14px color-mix(in srgb, var(--yd-color-state-accent) 10%, transparent 90%);
}

.yd-login-remember:focus-within {
  border-color: color-mix(in srgb, var(--yd-color-state-accent) 62%, transparent 38%);
  box-shadow:
    inset 2px 0 0 color-mix(in srgb, var(--yd-color-state-accent) 64%, transparent 36%),
    0 0 14px color-mix(in srgb, var(--yd-color-state-accent) 9%, transparent 91%);
}

.yd-login-submit {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  background-color: color-mix(in srgb, var(--yd-color-state-accent) 20%, transparent 80%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--yd-color-state-accent) 38%, transparent 62%),
    inset 0 -1px 0 color-mix(in srgb, var(--yd-color-border-muted) 42%, transparent 58%),
    inset 2px 0 0 color-mix(in srgb, var(--yd-color-state-accent) 68%, transparent 32%);
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease,
    color 140ms ease,
    transform 80ms ease;
}

.yd-login-submit:hover:not(:disabled),
.yd-login-submit:focus-visible:not(:disabled) {
  background-color: color-mix(in srgb, var(--yd-color-state-accent) 28%, transparent 72%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--yd-color-state-accent) 48%, transparent 52%),
    inset 0 -1px 0 color-mix(in srgb, var(--yd-color-border-strong) 46%, transparent 54%),
    inset 2px 0 0 color-mix(in srgb, var(--yd-color-state-accent) 82%, transparent 18%),
    0 0 14px color-mix(in srgb, var(--yd-color-state-accent) 12%, transparent 88%);
}

.yd-login-alert {
  animation: yd-login-alert-enter 180ms ease-out both;
}

@keyframes yd-login-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes yd-login-alert-enter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .yd-login-card,
  .yd-login-alert {
    animation: none;
  }
}
</style>
