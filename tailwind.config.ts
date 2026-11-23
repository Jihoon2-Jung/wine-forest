import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        subtle: 'var(--border-subtle)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        forest: 'var(--brand-forest)',
        'forest-hover': 'var(--brand-forest-hover)',
        burgundy: 'var(--brand-burgundy)',
        gold: 'var(--brand-gold)',
        wine: {
          r: 'var(--wine-r)',
          w: 'var(--wine-w)',
          sp: 'var(--wine-sp)',
          sw: 'var(--wine-sw)',
          ro: 'var(--wine-ro)',
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
