'use client';

import ChatContainer from '@/components/ChatContainer';
import { useSession, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChatPage() {
  const { data: session, status } = useSession();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Log auth status on client side
    console.log('Authentication status:', status);
    console.log('Session data:', session);
    
    // Explicitly redirect to sign-in when unauthenticated
    if (status === 'unauthenticated') {
      console.log('Redirecting to sign-in page...');
      // Option 1: Use Next.js router
      router.push('/auth/signin');
      
      // Option 2: Manual redirect as fallback (uncomment if router doesn't work)
      // window.location.href = '/auth/signin';
    }
    
    // Add window error handler to catch any client-side errors
    const handleError = (e: ErrorEvent) => {
      console.error('Client error:', e.error);
      setError(`Error: ${e.message}`);
    };
    
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, [status, session, router]);

  // Show loading indicator while checking session
  if (status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  // Display any caught errors
  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  // Show sign-in button if no session (as a fallback)
  if (!session) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-white">No active session. You should be redirected to login...</p>
        <button 
          onClick={() => signIn('google')}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-black p-4 sm:p-6 md:p-8">
      <ChatContainer />
    </div>
  );
} 