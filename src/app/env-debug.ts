'use client';

// This file exposes environment information for debugging only
// Do not include any sensitive values here

export function getEnvironmentInfo() {
  if (typeof window === 'undefined') {
    return {
      environment: 'server',
      origin: 'server-side-rendering',
      publicVars: {
        NEXT_PUBLIC_NEXTAUTH_URL: process.env.NEXT_PUBLIC_NEXTAUTH_URL || 'Not set',
        NODE_ENV: process.env.NODE_ENV || 'Not set'
      }
    };
  }

  return {
    environment: 'client',
    origin: window.location.origin,
    hostname: window.location.hostname,
    publicVars: {
      NEXT_PUBLIC_NEXTAUTH_URL: process.env.NEXT_PUBLIC_NEXTAUTH_URL || 'Not set',
      NODE_ENV: process.env.NODE_ENV || 'Not set'
    }
  };
} 