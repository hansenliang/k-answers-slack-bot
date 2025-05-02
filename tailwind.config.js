/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        notion: {
          light: {
            bg: '#ffffff',
            text: '#37352f',
            lightText: '#64748b',
            border: '#e0e0e0',
            hover: '#f5f5f5',
            accent: '#2e75cc',
            accentHover: '#1a5eb3',
            card: '#ffffff',
            selection: '#e6f1ff',
            error: '#e03e3e'
          },
          dark: {
            bg: '#191919',
            text: '#e0e0e0',
            lightText: '#999999',
            border: '#333333',
            hover: '#262626',
            accent: '#2e75cc',
            accentHover: '#5690de',
            card: '#262626',
            selection: '#1d3557',
            error: '#ff6b6b'
          }
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-in-out',
        'pulse-subtle': 'pulseSubtle 2s infinite',
        'rainbow-pulse': 'rainbowPulse 8s infinite linear',
        'border-glow': 'borderGlow 2s ease-in-out infinite',
        'message-in': 'messageIn 0.2s ease-out',
        'modal-in': 'modalIn 0.15s ease-out',
        'typing': 'typing 1.5s infinite ease-in-out',
        'word-appear': 'wordAppear 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideIn: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' }
        },
        rainbowPulse: {
          '0%': { 
            backgroundPosition: '0% 50%',
            backgroundSize: '200% 200%',
            opacity: '0.7'
          },
          '25%': {
            backgroundPosition: '50% 100%',
            backgroundSize: '250% 250%',
            opacity: '0.8'
          },
          '50%': { 
            backgroundPosition: '100% 50%',
            backgroundSize: '300% 300%',
            opacity: '0.9'
          },
          '75%': {
            backgroundPosition: '50% 0%',
            backgroundSize: '250% 250%',
            opacity: '0.8'
          },
          '100%': {
            backgroundPosition: '0% 50%',
            backgroundSize: '200% 200%',
            opacity: '0.7'
          }
        },
        borderGlow: {
          '0%, 100%': { 
            boxShadow: '0 0 10px rgba(66, 153, 225, 0.6)',
            borderColor: 'rgba(66, 153, 225, 0.8)'
          },
          '50%': { 
            boxShadow: '0 0 20px rgba(236, 72, 153, 0.8)',
            borderColor: 'rgba(236, 72, 153, 0.8)'
          }
        },
        messageIn: {
          '0%': { 
            transform: 'translateY(10px) scale(0.98)', 
            opacity: '0' 
          },
          '100%': { 
            transform: 'translateY(0) scale(1)', 
            opacity: '1' 
          }
        },
        modalIn: {
          '0%': { 
            transform: 'scale(0.95)', 
            opacity: '0' 
          },
          '100%': { 
            transform: 'scale(1)', 
            opacity: '1' 
          }
        },
        typing: {
          '0%, 100%': { 
            opacity: '0.3',
            transform: 'translateY(0px)'
          },
          '50%': { 
            opacity: '1',
            transform: 'translateY(-2px)'
          }
        },
        wordAppear: {
          '0%': { 
            opacity: '0',
            transform: 'translateY(10px) scale(0.95)'
          },
          '100%': { 
            opacity: '1',
            transform: 'translateY(0) scale(1)'
          }
        }
      },
      backgroundSize: {
        'rainbow': '200% 200%'
      }
    },
  },
  plugins: [
    function({ addUtilities }) {
      const newUtilities = {
        '.rainbow-bg': {
          background: 'linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab)',
          backgroundSize: '400% 400%',
        },
      }
      addUtilities(newUtilities)
    }
  ],
} 