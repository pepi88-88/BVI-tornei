// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx,js,jsx,mdx}',
    './components/**/*.{ts,tsx,js,jsx,mdx}',
    './src/**/*.{ts,tsx,js,jsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: 'rgb(240,125,0)',
          blue:   'rgb(5,43,88)',
        },
      },
      boxShadow: {
        brand: '0 8px 30px rgba(5,43,88,.35)',
      },
    },
  },
  plugins: [],
}

export default config
