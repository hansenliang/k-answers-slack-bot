'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

interface ChatInterfaceProps {
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ isProcessing, setIsProcessing }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load messages from localStorage on mount
  useEffect(() => {
    const savedMessages = localStorage.getItem('chatMessages');
    if (savedMessages) {
      try {
        const parsedMessages = JSON.parse(savedMessages);
        // Convert string timestamps back to Date objects
        const formattedMessages = parsedMessages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(formattedMessages);
      } catch (error) {
        console.error('Error parsing chat messages from localStorage:', error);
      }
    }
  }, []);

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('chatMessages', JSON.stringify(messages));
    }
  }, [messages]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleClearChat = () => {
    setMessages([]);
    localStorage.removeItem('chatMessages');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      role: 'user',
      timestamp: new Date(),
    };

    // Add user message to chat
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    try {
      // Call API to get response
      const response = await fetch('/api/ask-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: userMessage.content }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error: ${response.status}`);
      }

      // Add assistant's response to chat
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
      // Add error message
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

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area with clear button */}
      <div className="flex-grow overflow-y-auto p-4 space-y-4 relative">
        {messages.length > 0 && (
          <div className="absolute top-2 right-2 z-10">
            <button
              onClick={handleClearChat}
              className="text-xs py-1 px-2 rounded-md bg-notion-light-hover dark:bg-notion-dark-hover text-notion-light-lightText dark:text-notion-dark-lightText hover:bg-notion-light-selection dark:hover:bg-notion-dark-selection transition-colors"
            >
              Clear chat
            </button>
          </div>
        )}
        
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-notion-light-lightText dark:text-notion-dark-lightText text-center max-w-md">
              <svg 
                className="w-12 h-12 mx-auto mb-4 text-notion-light-accent dark:text-notion-dark-accent opacity-80" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4-4-4z" />
              </svg>
              <p className="text-lg font-medium mb-2">Ask me anything</p>
              <p className="text-sm">I'll search through your synced documents to find the best answer.</p>
            </div>
          </div>
        ) : (
          <AnimatePresence>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-notion-light-accent dark:bg-notion-dark-accent text-white'
                      : 'bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-text dark:text-notion-dark-text'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                  <div className={`text-xs mt-1 ${
                    message.role === 'user'
                      ? 'text-white text-opacity-70'
                      : 'text-notion-light-lightText dark:text-notion-dark-lightText'
                  }`}>
                    {formatTime(message.timestamp)}
                  </div>
                </div>
              </motion.div>
            ))}
            
            {/* Typing indicator when the AI is generating a response */}
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="flex justify-start"
              >
                <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-notion-light-selection dark:bg-notion-dark-selection text-notion-light-text dark:text-notion-dark-text">
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-notion-light-accent dark:bg-notion-dark-accent animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-notion-light-accent dark:bg-notion-dark-accent animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-notion-light-accent dark:bg-notion-dark-accent animate-bounce" style={{ animationDelay: '600ms' }}></div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-notion-light-border dark:border-notion-dark-border p-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="relative flex-grow">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="w-full rounded-lg border border-notion-light-border dark:border-notion-dark-border bg-notion-light-bg dark:bg-notion-dark-bg px-4 py-3 pr-12 text-notion-light-text dark:text-notion-dark-text placeholder-notion-light-lightText dark:placeholder-notion-dark-lightText focus:outline-none focus:ring-1 focus:ring-notion-light-accent dark:focus:ring-notion-dark-accent resize-none overflow-auto min-h-[56px] max-h-[120px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isProcessing}
              className={`absolute bottom-3 right-3 rounded-full p-1.5 ${
                !input.trim() || isProcessing
                  ? 'text-notion-light-border dark:text-notion-dark-border cursor-not-allowed'
                  : 'text-notion-light-accent dark:text-notion-dark-accent hover:bg-notion-light-selection dark:hover:bg-notion-dark-selection'
              } transition-colors`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </form>
        <div className="text-xs text-notion-light-lightText dark:text-notion-dark-lightText mt-2 text-center">
          Press Enter to send, Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
};

export default ChatInterface; 