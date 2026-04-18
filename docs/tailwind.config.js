/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', '"Cascadia Code"', 'monospace'],
      },
      colors: {
        rust: { 400: '#f38f6e', 500: '#de6b39' },
      },
    },
  },
  plugins: [],
};
