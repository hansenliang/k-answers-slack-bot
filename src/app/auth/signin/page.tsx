'use client';

import { signIn } from 'next-auth/react';

export default function SignIn() {
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
        <div className="mt-8">
          <button
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="w-full flex justify-center py-2 px-4 rounded-lg text-sm font-medium text-white bg-notion-light-accent dark:bg-notion-dark-accent hover:bg-notion-light-accentHover dark:hover:bg-notion-dark-accentHover transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
} 