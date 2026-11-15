module.exports = {
  content: ['./*.html', './js/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: '#070b16',
        navy: '#0b1325',
        panel: '#101a30',
        line: '#1f2d4a',
        sky: { 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
        ember: { 300: '#ffb48a', 400: '#ff935c', 500: '#ff7a3d', 600: '#ec5f1c' }
      }
    }
  },
  plugins: []
};
