/**
 * Utility functions for debugging animations
 */

// Logs animation debug information if enabled
export const debugAnimation = (message: string, data?: any) => {
  if (typeof window !== 'undefined' && window.localStorage.getItem('debug-animations') === 'true') {
    console.log(`[Animation Debug] ${message}`, data || '');
  }
};

// Enables animation debugging in local storage
export const enableAnimationDebugging = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('debug-animations', 'true');
    console.log('Animation debugging enabled. Refresh the page to apply.');
  }
};

// Disables animation debugging in local storage
export const disableAnimationDebugging = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('debug-animations');
    console.log('Animation debugging disabled. Refresh the page to apply.');
  }
}; 