'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function SignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      setIsSigningIn(true);
      setError(null);
      console.log('Starting Google sign-in process...');
      
      // Add more specific redirect URL
      await signIn('google', { 
        callbackUrl: '/chat',
        redirect: true
      });
    } catch (e: any) {
      console.error('Sign-in error:', e);
      setError(e?.message || 'Sign-in failed');
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-notion-light-bg dark:bg-notion-dark-bg">
      <div className="max-w-md w-full space-y-8 p-8 bg-notion-light-card dark:bg-notion-dark-card rounded-xl shadow-lg border border-notion-light-border dark:border-notion-dark-border animate-fade-in">
        <div>
          <h2 className="text-center text-2xl font-bold text-notion-light-text dark:text-notion-dark-text">
            Sign in to K:Answers bot
          </h2>
          <p className="mt-2 text-center text-sm text-notion-light-lightText dark:text-notion-dark-lightText">
            Access your PRDs and start drafting
          </p>
        </div>
        
        {error && (
          <div className="p-3 bg-red-100 dark:bg-red-900 rounded border border-red-300 dark:border-red-700 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}
        
        <div className="mt-8">
          <button
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="w-full flex justify-center py-2 px-4 rounded-lg text-sm font-medium text-white bg-notion-light-accent dark:bg-notion-dark-accent hover:bg-notion-light-accentHover dark:hover:bg-notion-dark-accentHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
        
        <div className="mt-4 text-sm text-center">
          <p className="text-notion-light-lightText dark:text-notion-dark-lightText">
            Having trouble? Try the <a href="/auth-test" className="underline">auth test page</a>
          </p>
        </div>
      </div>
    </div>
  );
} 