'use client';

import { useSession } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import { useState } from 'react';

export default function AskPage() {
  const { data: session, status } = useSession();
  const [isProcessing, setIsProcessing] = useState(false);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-notion-light-bg dark:bg-notion-dark-bg flex items-center justify-center">
        <div className="text-notion-light-text dark:text-notion-dark-text animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-notion-light-bg dark:bg-notion-dark-bg">
      <Sidebar />
      <div className="ml-64 flex flex-col items-center justify-center min-h-screen pt-6 px-4">
        <div className="max-w-3xl w-full flex flex-col flex-grow">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-notion-light-text dark:text-notion-dark-text">Ask a Question</h1>
            <p className="text-notion-light-lightText dark:text-notion-dark-lightText mt-2">
              Get answers from your synced documents using AI
            </p>
          </div>
          
          <div className="flex-grow flex flex-col bg-notion-light-card dark:bg-notion-dark-card rounded-xl shadow-sm border border-notion-light-border dark:border-notion-dark-border overflow-hidden animate-fade-in">
            <ChatInterface isProcessing={isProcessing} setIsProcessing={setIsProcessing} />
          </div>
        </div>
      </div>
    </div>
  );
} 