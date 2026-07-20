/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Ink palette is inverted from Tailwind's usual convention so that
        // existing class references (bg-ink-700 = card, text-ink-100 = secondary
        // text, etc.) keep working after switching from dark to light theme.
        ink: {
          50:  '#0b0f1a',   // primary text (was pure white)
          100: '#1f2937',   // very dark text
          200: '#4a5568',   // secondary text
          300: '#6b7280',
          400: '#8994a3',   // muted text
          500: '#e5e9ef',   // borders / dividers
          600: '#f3f4f6',   // hover surface
          700: '#ffffff',   // card surface (white)
          800: '#fafbfc',   // sidebar surface
          900: '#ffffff',   // page bg (was near-black)
          950: '#ffffff',   // deepest surface (was pure black-ish)
        },
        // Fashion Fusion brand orange — unchanged, still the single accent
        brand: {
          50:  '#fff1ea',
          100: '#ffe0cc',
          200: '#ffb185',
          300: '#ff8a4d',
          400: '#ff7029',
          500: '#fe6620',
          600: '#ed5212',
          700: '#c43e09',
          800: '#8a2c08',
          900: '#4a1804',
        },
        gold: {
          400: '#d6b347',
          500: '#c9a227',
          600: '#a8841e',
        },
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
      backgroundImage: {
        'card-gradient':    'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #fafbfc 0%, #f5f7fa 100%)',
        'glow-brand':       'radial-gradient(circle at top right, rgba(254,102,32,0.10), transparent 60%)',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        fusion:  ['"Russo One"', '"Plus Jakarta Sans"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(254,102,32,0.30), 0 8px 24px -8px rgba(254,102,32,0.35)',
        card: '0 1px 3px 0 rgba(15,23,42,0.05), 0 1px 2px -1px rgba(15,23,42,0.05)',
      },
    },
  },
  plugins: [],
};
