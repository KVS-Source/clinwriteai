import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // Platform chrome
        slate: {
          900: '#1E293B',
          700: '#334155',
          600: '#475569',
          500: '#64748B',
          400: '#94A3B8',
          300: '#CBD5E1',
          200: '#E2E8F0',
          100: '#F1F5F9',
          50:  '#F8FAFC',
        },
        // Module A — Clinical Writing
        blue: {
          700: '#1D4ED8',
          600: '#2563EB',
          100: '#DBEAFE',
          50:  '#EFF6FF',
        },
        // Module B — Scientific Writing
        teal: { 600: '#0D9488' },
        // Module C — Medical Writing
        violet: { 700: '#6D28D9', 600: '#7C3AED', 200: '#DDD6FE', 100: '#EDE9FE', 50: '#F5F3FF' },
        // Module D — Regulatory Writing (crimson) + amber
        amber:   { 600: '#D97706' },
        crimson: { 700: '#B0200D', 200: '#FFC5C5', 100: '#FFE0E0', 50: '#FFF5F5' },
        // Module E — Ideation & Publishing
        rose: { 600: '#E11D48' },
        // AI content colours
        'ai-bg':     '#F0F7FF',
        'ai-border': '#93C5FD',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      boxShadow: {
        'focus':      '0 0 0 3px rgba(37, 99, 235, 0.12)',
        'panel':      '-16px 0 40px rgba(15, 23, 42, 0.12)',
        'modal':      '0 24px 60px rgba(15, 23, 42, 0.28)',
        'sticky-bar': '0 -4px 12px rgba(15, 23, 42, 0.08)',
      },
      animation: {
        'shimmer':     'auroraShimmer 1.2s ease-in-out infinite',
        'pulse-blue':  'auroraPulse 2s ease-out infinite',
        'pulse-green': 'auroraGreenPulse 2s ease-out infinite',
        'pulse-amber': 'auroraAmberPulse 2s ease-out infinite',
        'spin-aurora': 'auroraSpin 0.7s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
