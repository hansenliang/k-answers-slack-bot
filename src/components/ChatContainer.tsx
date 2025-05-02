'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from 'next/navigation';
import AnimatedResponse from '@/components/streaming/AnimatedResponse';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isComplete?: boolean; // Add isComplete flag for streaming responses
}

export default function ChatContainer() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWaitingForFirstChunk, setIsWaitingForFirstChunk] = useState(false);
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
      isComplete: true
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);
    setIsWaitingForFirstChunk(true);

    // Create a response ID but don't add the message yet
    const responseId = `response-${Date.now()}`;

    try {
      // Format previous messages for the API
      // We filter to keep only the last 10 messages to avoid hitting token limits
      const previousMessages = messages
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      
      // Add current user message
      previousMessages.push({
        role: userMessage.role,
        content: userMessage.content
      });

      // Call streaming API with conversation history
      const response = await fetch('/api/ask-question-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          question: userMessage.content,
          conversationHistory: previousMessages
        }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      // Process the streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        let accumulatedContent = '';
        let messageAdded = false;
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          // Decode and accumulate the chunk
          const chunk = decoder.decode(value, { stream: true });
          accumulatedContent += chunk;
          
          // If this is the first chunk, add the assistant message
          if (!messageAdded && accumulatedContent.trim()) {
            setIsWaitingForFirstChunk(false);
            setMessages(prev => [
              ...prev,
              {
                id: responseId,
                content: accumulatedContent,
                role: 'assistant',
                timestamp: new Date(),
                isComplete: false
              }
            ]);
            messageAdded = true;
          } else if (messageAdded) {
            // Update the message content as chunks arrive
            setMessages(prev => 
              prev.map(msg => 
                msg.id === responseId 
                  ? { ...msg, content: accumulatedContent } 
                  : msg
              )
            );
          }
        }
        
        // If no message was ever added (rare case), add it now
        if (!messageAdded) {
          setMessages(prev => [
            ...prev,
            {
              id: responseId,
              content: accumulatedContent || "I don't have an answer for that.",
              role: 'assistant',
              timestamp: new Date(),
              isComplete: true
            }
          ]);
        } else {
          // Mark the message as complete
          setMessages(prev => 
            prev.map(msg => 
              msg.id === responseId 
                ? { ...msg, isComplete: true } 
                : msg
            )
          );
        }
      }
    } catch (error) {
      setIsWaitingForFirstChunk(false);
      console.error('Error asking question:', error);
      // Add error message
      setMessages(prev => [
        ...prev,
        {
          id: responseId,
          content: error instanceof Error 
            ? `Error: ${error.message}` 
            : "I'm sorry, I couldn't process your question. Please try again.",
          role: 'assistant',
          timestamp: new Date(),
          isComplete: true
        }
      ]);
    } finally {
      setIsWaitingForFirstChunk(false);
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
              I&apos;ll search through your synced documents to find the most relevant answers.
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
                  {message.role === 'assistant' ? (
                    <>
                      <AnimatedResponse 
                        text={message.content} 
                        isComplete={message.isComplete || false}
                        className="text-[1rem] whitespace-pre-wrap"
                        timestamp={message.timestamp}
                        showTimestamp={!!message.content}
                      />
                    </>
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap text-[1rem]">{message.content}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {formatTime(message.timestamp)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator - only show when waiting for first chunk */}
            {isWaitingForFirstChunk && (
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
          <div className="absolute -inset-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 via-pink-500 via-rose-500 to-blue-500 rounded-[14px] opacity-75 blur-[3px] animate-rainbow-pulse"></div>
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
              className={`absolute top-1/2 -translate-y-1/2 right-3 rounded-full p-2 transition-colors ${
                input.trim() && !isProcessing 
                  ? 'bg-white text-black hover:bg-gray-200' 
                  : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 19V5M5 12l7-7 7 7" />
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