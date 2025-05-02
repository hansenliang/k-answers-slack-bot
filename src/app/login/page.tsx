'use client';

import { useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function DirectLoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Auto-redirect if already authenticated
  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/chat');
    }
  }, [status, router]);

  // Auto-trigger sign-in
  useEffect(() => {
    if (status === 'unauthenticated') {
      console.log('Automatically triggering Google sign-in...');
      try {
        signIn('google', { callbackUrl: '/chat' });
      } catch (e) {
        console.error('Auto sign-in error:', e);
      }
    }
  }, [status]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-4">
      {status === 'loading' && (
        <div className="animate-pulse text-xl">Checking authentication status...</div>
      )}
      
      {status === 'unauthenticated' && (
        <>
          <h1 className="text-2xl font-bold">Signing in...</h1>
          <p>If you're not automatically redirected, click the button below:</p>
          <button
            onClick={() => signIn('google', { callbackUrl: '/chat' })}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded"
          >
            Sign in with Google
          </button>
          <div className="mt-4 text-sm">
            <a href="/auth-test" className="underline">Troubleshoot authentication</a>
          </div>
        </>
      )}
      
      {status === 'authenticated' && (
        <div>
          <p>You are signed in! Redirecting to chat...</p>
        </div>
      )}
    </div>
  );
} 