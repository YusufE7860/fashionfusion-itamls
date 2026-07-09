/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark surface palette
        ink: {
          950: '#050810',   // page background — near black, brand match
          900: '#0a0f1a',
          800: '#0f1626',   // sidebar
          700: '#141c30',   // card surface
          600: '#1c2640',   // hover
          500: '#293659',   // border
          400: '#3a4f7d',
          300: '#5d72a3',
          200: '#7a8aa8',   // muted text
          100: '#c8d3e6',   // secondary text
          50:  '#e8eef9',
        },
        // FUSION brand orange (primary accent)
        brand: {
          50:  '#fff2eb',
          100: '#ffd9c2',
          200: '#ffb185',
          300: '#ff8a4d',
          400: '#ff7029',
          500: '#fe6620',   // FUSION primary
          600: '#ed5212',
          700: '#c43e09',
          800: '#8a2c08',
          900: '#4a1804',
        },
        // Gold kept as a secondary highlight (warranty/awards/pills)
        gold: {
          50:  '#fdf8e9',
          100: '#fbecb2',
          200: '#f4d671',
          300: '#e8c053',
          400: '#d4b13a',
          500: '#c9a227',
          600: '#a8841e',
          700: '#856819',
        },
        // Tertiary teal
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
      backgroundImage: {
        'card-gradient': 'linear-gradient(135deg, rgba(41,54,89,0.45) 0%, rgba(20,28,48,0.85) 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #0f1626 0%, #050810 100%)',
        'glow-brand': 'radial-gradient(circle at top right, rgba(254,102,32,0.22), transparent 60%)',
        'glow-gold': 'radial-gradient(circle at top right, rgba(201,162,39,0.18), transparent 60%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        fusion: ['"Russo One"', '"Plus Jakarta Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(254,102,32,0.30), 0 10px 30px -8px rgba(254,102,32,0.45)',
        card: '0 10px 30px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(41,54,89,0.5) inset',
      },
    },
  },
  plugins: [],
};
