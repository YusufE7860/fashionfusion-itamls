/** Mobile design tokens — kept in sync with apps/web's Tailwind palette. */
export const colors = {
  bg:        '#050810',
  bgElev:    '#0f1626',
  card:      '#141c30',
  cardHover: '#1c2640',
  border:    '#293659',
  textPrimary:   '#ffffff',
  textSecondary: '#c8d3e6',
  textMuted:     '#7a8aa8',
  brand:     '#fe6620',
  brandDim:  '#ed5212',
  gold:      '#c9a227',
  success:   '#10b981',
  warn:      '#f59e0b',
  danger:    '#ef4444',
};

export const radius = { sm: 6, md: 10, lg: 16, xl: 22 };

export const typography = {
  display: { fontWeight: '800', letterSpacing: -0.3 },
  bodyMd:  { fontSize: 14, color: colors.textSecondary },
  small:   { fontSize: 12, color: colors.textMuted },
};
