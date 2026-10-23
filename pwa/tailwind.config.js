/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {
      colors: {
        klar: '#16a34a',
        delvis: '#d97706',
        ejklar: '#6b7280',
      },
    },
  },
  plugins: [],
};
