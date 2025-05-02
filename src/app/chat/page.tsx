'use client';

import ChatContainer from '@/components/ChatContainer';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

export default function ChatPage() {
  const { data: session, status } = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Log auth status on client side
    console.log('Authentication status:', status);
    console.log('Session data:', session);
    
    // Check for common issues
    if (status === 'unauthenticated') {
      console.warn('User is not authenticated, should redirect to sign-in');
    }
    
    // Add window error handler to catch any client-side errors
    const handleError = (e: ErrorEvent) => {
      console.error('Client error:', e.error);
      setError(`Error: ${e.message}`);
    };
    
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, [status, session]);

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

  // Redirect if no session (handled by next-auth)
  if (!session) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white">
        <p className="text-white">No active session. You should be redirected to login...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-black p-4 sm:p-6 md:p-8">
      <ChatContainer />
    </div>
  );
} 