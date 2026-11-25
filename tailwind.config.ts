import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--bg-canvas-rgb) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
        subtle: 'rgb(var(--border-subtle-rgb) / <alpha-value>)',
        primary: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
        secondary: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
        forest: 'rgb(var(--brand-forest-rgb) / <alpha-value>)',
        'forest-hover': 'rgb(var(--brand-forest-hover-rgb) / <alpha-value>)',
        burgundy: 'rgb(var(--brand-burgundy-rgb) / <alpha-value>)',
        gold: 'rgb(var(--brand-gold-rgb) / <alpha-value>)',
        wine: {
          r: 'rgb(var(--wine-r-rgb) / <alpha-value>)',
          w: 'rgb(var(--wine-w-rgb) / <alpha-value>)',
          sp: 'rgb(var(--wine-sp-rgb) / <alpha-value>)',
          sw: 'rgb(var(--wine-sw-rgb) / <alpha-value>)',
          ro: 'rgb(var(--wine-ro-rgb) / <alpha-value>)',
        },
        status: {
          ok: 'rgb(var(--status-ok-rgb) / <alpha-value>)',
          warn: 'rgb(var(--status-warn-rgb) / <alpha-value>)',
          danger: 'rgb(var(--status-danger-rgb) / <alpha-value>)',
          neutral: 'rgb(var(--status-neutral-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          'Helvetica Neue',
          'Segoe UI',
          'Apple SD Gothic Neo',
          'Noto Sans KR',
          'Malgun Gothic',
          'sans-serif',
        ],
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 25, 20, 0.05), 0 1px 2px rgba(15, 25, 20, 0.03)',
        'card-hover': '0 8px 24px -6px rgba(15, 25, 20, 0.12)',
        sheet: '0 -8px 30px rgba(0, 0, 0, 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
