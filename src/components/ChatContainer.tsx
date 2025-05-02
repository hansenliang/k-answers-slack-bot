'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from 'next/navigation';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export default function ChatContainer() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the input field on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    try {
      const response = await fetch('/api/ask-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage.content }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error: ${response.status}`);
      }

      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          content: data.answer,
          role: 'assistant',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Error asking question:', error);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          content: error instanceof Error 
            ? `Error: ${error.message}` 
            : "I'm sorry, I couldn't process your question. Please try again.",
          role: 'assistant',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsProcessing(false);
      // Re-focus the input after processing
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  // Clear chat history
  const handleClearChat = () => {
    setMessages([]);
  };

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative flex h-full w-full max-w-[800px] flex-col overflow-hidden rounded-lg bg-black text-white shadow-2xl">
      {/* Header */}
      <div className="flex h-[44px] items-center justify-between border-b border-zinc-900 px-4">
        <h1 className="text-[1.25rem] font-medium">K:Answers Chat</h1>
        <button 
          className="text-[0.875rem] text-zinc-400 hover:text-white transition-colors"
          onClick={() => router.push('/manage-context')}
          aria-label="Manage context"
        >
          Manage context
        </button>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 rounded-full bg-zinc-900 p-4 opacity-70">
              <svg className="h-8 w-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-medium text-zinc-300">Start by asking a question</h3>
            <p className="text-sm text-zinc-500 max-w-sm">
              I'll search through your synced documents to find the most relevant answers.
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div 
                key={message.id} 
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}
              >
                <div
                  className={`max-w-[80%] rounded-[12px] px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-zinc-800'
                      : 'bg-zinc-900'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-[1rem]">{message.content}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {formatTime(message.timestamp)}
                  </div>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isProcessing && (
              <div className="flex justify-start animate-fade-in">
                <div className="max-w-[80%] rounded-[12px] bg-zinc-900 px-4 py-3">
                  <div className="flex items-center space-x-1">
                    <div className="h-2 w-2 rounded-full bg-zinc-600 animate-typing" style={{ animationDelay: '0ms' }}></div>
                    <div className="h-2 w-2 rounded-full bg-zinc-600 animate-typing" style={{ animationDelay: '300ms' }}></div>
                    <div className="h-2 w-2 rounded-full bg-zinc-600 animate-typing" style={{ animationDelay: '600ms' }}></div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area - with rainbow glow */}
      <div className="border-t border-zinc-900 bg-black p-4">
        {messages.length > 0 && (
          <div className="mb-2 flex justify-end">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleClearChat}
              className="text-xs text-zinc-500 hover:text-white"
            >
              Clear chat
            </Button>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="relative">
          <div className="absolute -inset-[1px] bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 rounded-[14px] opacity-70 blur-[1px] animate-rainbow-pulse"></div>
          <div className="relative">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="min-h-[56px] max-h-[120px] resize-none overflow-auto rounded-[12px] border-0 bg-zinc-900 px-4 py-3 pr-12 text-white placeholder-zinc-600 focus:outline-none focus:ring-0 w-full"
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isProcessing}
              aria-label="Send message"
              className="absolute bottom-3 right-3 rounded-full p-1.5 bg-transparent text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </form>
        <div className="mt-2 text-center text-xs text-zinc-600">
          Press Enter to send, Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
} 