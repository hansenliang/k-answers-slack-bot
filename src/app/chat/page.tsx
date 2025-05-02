'use client';

import ChatContainer from '@/components/ChatContainer';
import { useSession } from 'next-auth/react';

export default function ChatPage() {
  const { data: session, status } = useSession();

  // Show loading indicator while checking session
  if (status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-900 text-white">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  // Redirect if no session (handled by next-auth)
  if (!session) {
    return null;
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-900 p-4">
      <ChatContainer />
    </div>
  );
} 