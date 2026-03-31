import type { GlobalThemeOverrides } from 'naive-ui'

import { DEFAULT_APP_THEME_TOKENS } from './default-theme'
import type { AppThemeTokens } from './tokens'

export const resolveThemeTokens = (): AppThemeTokens => {
  return DEFAULT_APP_THEME_TOKENS
}

export const createNaiveThemeOverrides = (tokens: AppThemeTokens): GlobalThemeOverrides => {
  return {
    common: {
      bodyColor: tokens.colors.bgApp,
      cardColor: tokens.colors.bgPanel,
      modalColor: tokens.colors.bgElevated,
      popoverColor: tokens.colors.bgElevated,
      tableColor: tokens.colors.bgPanel,
      borderColor: tokens.colors.borderStrong,
      textColorBase: tokens.colors.textPrimary,
      textColor1: tokens.colors.textPrimary,
      textColor2: tokens.colors.textSecondary,
      textColor3: tokens.colors.textMuted,
      textColorDisabled: tokens.colors.textMuted,
      placeholderColor: tokens.colors.textMuted,
      inputColorDisabled: tokens.colors.bgPanel,
      primaryColor: tokens.colors.stateAccent,
      primaryColorHover: tokens.colors.stateInfo,
      primaryColorPressed: tokens.colors.stateAccent,
      primaryColorSuppl: tokens.colors.stateAccent,
      infoColor: tokens.colors.stateInfo,
      infoColorHover: tokens.colors.stateInfo,
      infoColorPressed: tokens.colors.stateInfo,
      infoColorSuppl: tokens.colors.stateInfo,
      successColor: tokens.colors.stateSuccess,
      successColorHover: tokens.colors.stateSuccess,
      successColorPressed: tokens.colors.stateSuccess,
      successColorSuppl: tokens.colors.stateSuccess,
      warningColor: tokens.colors.stateWarning,
      warningColorHover: tokens.colors.stateWarning,
      warningColorPressed: tokens.colors.stateWarning,
      warningColorSuppl: tokens.colors.stateWarning,
      errorColor: tokens.colors.stateDanger,
      errorColorHover: tokens.colors.stateDanger,
      errorColorPressed: tokens.colors.stateDanger,
      errorColorSuppl: tokens.colors.stateDanger,
      fontFamily: tokens.typography.fontSans,
      fontFamilyMono: tokens.typography.fontMono,
      borderRadius: tokens.radius.md,
      borderRadiusSmall: tokens.radius.sm,
      heightMedium: '36px'
    },
    Card: {
      color: tokens.colors.bgPanel,
      colorModal: tokens.colors.bgElevated,
      borderColor: tokens.colors.borderMuted,
      titleTextColor: tokens.colors.textPrimary,
      textColor: tokens.colors.textSecondary,
      borderRadius: tokens.radius.lg
    },
    Layout: {
      color: tokens.colors.bgApp,
      siderColor: tokens.colors.bgPanel,
      headerColor: tokens.colors.bgPanel
    },
    Input: {
      color: tokens.colors.bgApp,
      colorFocus: tokens.colors.bgApp,
      colorDisabled: tokens.colors.bgPanel,
      border: `1px solid ${tokens.colors.borderStrong}`,
      borderHover: `1px solid ${tokens.colors.stateInfo}`,
      borderFocus: `1px solid ${tokens.colors.stateAccent}`,
      textColor: tokens.colors.textPrimary,
      placeholderColor: tokens.colors.textMuted,
      caretColor: tokens.colors.stateAccent
    },
    DataTable: {
      thColor: tokens.colors.bgPanel,
      tdColor: tokens.colors.bgApp,
      borderColor: tokens.colors.borderMuted,
      thTextColor: tokens.colors.textSecondary,
      tdTextColor: tokens.colors.textPrimary
    },
    Drawer: {
      color: tokens.colors.bgElevated,
      borderRadius: tokens.radius.lg
    },
    Modal: {
      color: tokens.colors.bgElevated,
      borderRadius: tokens.radius.lg
    },
    Popover: {
      color: tokens.colors.bgElevated
    },
    Empty: {
      textColor: tokens.colors.textMuted,
      iconColor: tokens.colors.textMuted,
      extraTextColor: tokens.colors.textSecondary
    }
  }
}
