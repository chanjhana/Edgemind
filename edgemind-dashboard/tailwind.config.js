/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        abb: {
          red:    '#ff000f',
          black:  '#000000',
          white:  '#ffffff',
          gray1:  '#262626',
          gray2:  '#6e6e6e',
          gray3:  '#a9a9a9',
          gray4:  '#d2d2d2',
          gray5:  '#f0f0f0',
          gray6:  '#fafafa',
          blue:   '#004c97',
          green:  '#007a33',
          yellow: '#ffd100',
        },
      },
    },
  },
  plugins: [],
}
