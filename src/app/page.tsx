'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/chat');
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-900 text-white">
      <div className="animate-pulse">Redirecting to chat...</div>
    </div>
  );
}
