'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/chat');
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-black text-white">
      <div className="animate-pulse text-zinc-400">Redirecting to chat...</div>
    </div>
  );
}
