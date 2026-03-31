import { applyThemeCssVariables } from '../lib/theme/apply-css-vars'
import { resolveThemeTokens } from '../lib/theme/resolver'

export default defineNuxtPlugin(() => {
  const themeTokens = resolveThemeTokens()
  applyThemeCssVariables(themeTokens)
})
