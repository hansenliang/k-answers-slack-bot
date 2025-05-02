'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ManageContextModal from './ManageContextModal';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

export default function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load messages from localStorage on mount
  useEffect(() => {
    const savedMessages = localStorage.getItem('chatMessages');
    if (savedMessages) {
      try {
        const parsedMessages = JSON.parse(savedMessages);
        const formattedMessages = parsedMessages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(formattedMessages);
      } catch (error) {
        console.error('Error parsing chat messages:', error);
      }
    }
  }, []);

  // Save messages to localStorage when they change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('chatMessages', JSON.stringify(messages));
    }
  }, [messages]);

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
    }
  };

  // Clear chat history
  const handleClearChat = () => {
    setMessages([]);
    localStorage.removeItem('chatMessages');
  };

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-gray-900 text-white shadow-2xl">
      {/* Rainbow border effect */}
      <div className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500 p-[2px] opacity-70 blur-[2px] animate-pulse"></div>
      
      {/* Header with context management button */}
      <div className="flex items-center justify-between border-b border-gray-800 p-4">
        <h1 className="text-xl font-bold">K:Answers Chat</h1>
        <Button 
          variant="ghost" 
          className="text-sm text-gray-400 hover:text-white"
          onClick={() => setIsModalOpen(true)}
          aria-label="Manage context"
        >
          Manage context
        </Button>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 rounded-full bg-gray-800 p-4">
              <svg className="h-8 w-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-medium">Ask me anything</h3>
            <p className="text-sm text-gray-400">I'll search through your synced documents to find answers.</p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div 
                key={message.id} 
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600'
                      : 'bg-gray-800'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {formatTime(message.timestamp)}
                  </div>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isProcessing && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-gray-800 px-4 py-3">
                  <div className="flex items-center space-x-1">
                    <div className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    <div className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '600ms' }}></div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800 bg-gray-900 p-4">
        {messages.length > 0 && (
          <div className="mb-2 flex justify-end">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleClearChat}
              className="text-xs text-gray-400 hover:text-white"
            >
              Clear chat
            </Button>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="relative flex-grow">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="min-h-[56px] max-h-[120px] resize-none overflow-auto rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 pr-12 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <Button
              type="submit"
              disabled={!input.trim() || isProcessing}
              aria-label="Send message"
              className="absolute bottom-3 right-3 rounded-full p-1.5 bg-transparent hover:bg-gray-700"
            >
              <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </Button>
          </div>
        </form>
        <div className="mt-2 text-center text-xs text-gray-500">
          Press Enter to send, Shift+Enter for a new line
        </div>
      </div>

      {/* Context Management Modal */}
      <ManageContextModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
} 