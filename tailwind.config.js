/** @type {import('tailwindcss').Config} */
const rgb = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      spacing: {
        9.5: '2.375rem',
        13: '3.25rem',
        15: '3.75rem',
        18: '4.5rem',
      },
      opacity: {
        8: '0.08',
        12: '0.12',
        15: '0.15',
        45: '0.45',
        85: '0.85',
      },
      colors: {
        bg: rgb('bg'),
        surface: {
          DEFAULT: rgb('surface'),
          2: rgb('surface-2'),
          3: rgb('surface-3'),
        },
        line: {
          DEFAULT: rgb('border'),
          strong: rgb('border-strong'),
        },
        ink: {
          DEFAULT: rgb('text'),
          2: rgb('text-2'),
          muted: rgb('muted'),
        },
        brand: {
          DEFAULT: rgb('brand'),
          hover: rgb('brand-hover'),
          contrast: rgb('brand-contrast'),
        },
        ok: rgb('ok'),
        warn: rgb('warn'),
        danger: rgb('danger'),
        info: rgb('info'),
        purple: rgb('purple'),
        rail: {
          DEFAULT: rgb('rail'),
          text: rgb('rail-text'),
          hover: rgb('rail-hover'),
        },
        overlay: rgb('overlay'),
      },
      borderColor: {
        DEFAULT: rgb('border'),
      },
      fontFamily: {
        sans: ['Cairo', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Tahoma', 'sans-serif'],
        mono: ['ui-monospace', 'Cascadia Mono', 'Segoe UI Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        brand: '0 4px 14px rgb(var(--brand-rgb) / 0.32)',
        ok: '0 6px 18px rgb(var(--ok-rgb) / 0.34)',
      },
      fontSize: {
        '2xs': ['0.6875rem', '1rem'],
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
