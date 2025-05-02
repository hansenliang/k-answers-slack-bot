'use client';

import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { debugAnimation } from '@/lib/animation-debug';

interface AnimatedResponseProps {
  text: string;
  isComplete: boolean;
  className?: string;
  timestamp?: Date;
  showTimestamp?: boolean;
}

/**
 * AnimatedResponse - Renders animated text that appears word by word
 * Each word fades in elegantly with a subtle left-to-right animation
 */
const AnimatedResponse: React.FC<AnimatedResponseProps> = ({ 
  text, 
  isComplete,
  className = '',
  timestamp,
  showTimestamp = false
}) => {
  // Process text to preserve formatting
  // Instead of simple word splitting, handle whitespace preservation
  const processText = (text: string) => {
    // First, remove carriage returns
    let processedText = text.replace(/\r/g, '');
    
    // Remove only the leading spaces after newlines
    // This preserves spaces elsewhere in the text for proper copying
    processedText = processedText.replace(/\n[ ]+/g, '\n');
    
    // Split by spaces but keep track of consecutive spaces
    const tokens = [];
    let currentToken = '';
    let inWhitespace = false;
    
    for (let i = 0; i < processedText.length; i++) {
      const char = processedText[i];
      
      if (char === ' ') {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
        
        tokens.push(' ');
        inWhitespace = true;
      } else if (char === '\n') {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
        
        tokens.push('\n');
        inWhitespace = false; // Reset whitespace flag at newline
      } else {
        if (inWhitespace) {
          inWhitespace = false;
        }
        currentToken += char;
      }
    }
    
    if (currentToken) {
      tokens.push(currentToken);
    }
    
    return tokens;
  };
  
  const textTokens = text ? processText(text) : [];
  const [visibleTokens, setVisibleTokens] = useState<number>(0);
  
  // Reference for the container
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Reference to the scrollable parent (will be found during mounting)
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const lastScrollHeightRef = useRef<number>(0);
  
  // Find the scrollable container on mount
  useEffect(() => {
    if (!containerRef.current || !text) return;
    
    // Find the closest scrollable parent (with overflow-y-auto or overflow-y-scroll)
    let parent = containerRef.current.parentElement;
    while (parent) {
      const overflowY = window.getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollContainerRef.current = parent;
        break;
      }
      parent = parent.parentElement;
    }
    
    // If we couldn't find a scrollable parent through style checking,
    // look for a common class pattern in the codebase
    if (!scrollContainerRef.current) {
      const messageContainer = containerRef.current.closest('.overflow-y-auto');
      if (messageContainer && messageContainer instanceof HTMLElement) {
        scrollContainerRef.current = messageContainer;
      }
    }
    
    // Store initial scroll height
    if (scrollContainerRef.current) {
      lastScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
    }
    
    // Initial scroll to bottom if found a container
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    
    // Log debug information
    debugAnimation('Found scrollable container', { 
      found: !!scrollContainerRef.current,
      containerSelector: scrollContainerRef.current?.className || 'none'
    });
  }, [text]);
  
  // Handle smooth token-by-token scrolling without the jumpiness
  useEffect(() => {
    // Only handle scrolling if we're actively streaming (not complete)
    // and we have found a scrollable container
    if (!scrollContainerRef.current || visibleTokens === 0 || !text) return;
    
    const scrollContainer = scrollContainerRef.current;
    
    // Check if we're near the bottom already (within 100px)
    const isNearBottom = 
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 100;
    
    // Get the new scroll height
    const newScrollHeight = scrollContainer.scrollHeight;
    
    // If content height has increased and we were already at the bottom
    // or if we're still streaming (not complete), scroll to the new bottom
    if ((newScrollHeight > lastScrollHeightRef.current && isNearBottom) || !isComplete) {
      // Use direct scrollTop assignment for responsive scrolling without animation
      // Animation causes the jumpiness we're trying to avoid
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
    
    // Update the last scroll height reference
    lastScrollHeightRef.current = newScrollHeight;
  }, [visibleTokens, isComplete, text]);
  
  // Format timestamp
  const formatTime = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Debug logging to help troubleshoot the animation
  useEffect(() => {
    if (!text) return;
    debugAnimation(`Rendering ${textTokens.length} tokens, isComplete: ${isComplete}`, { 
      textLength: text.length,
      visibleTokens,
      containerHeight: containerRef.current?.offsetHeight
    });
  }, [textTokens.length, isComplete, text, visibleTokens]);
  
  // Update visible tokens count whenever text changes
  useEffect(() => {
    if (!text) return;
    if (visibleTokens < textTokens.length) {
      const timer = setTimeout(() => {
        setVisibleTokens(prev => Math.min(prev + 1, textTokens.length));
      }, 30); // Adjust this timing to match the word appearance rate
      
      return () => clearTimeout(timer);
    }
  }, [textTokens.length, visibleTokens, text]);
  
  // If there's no text, don't render anything
  if (!text) return null;
  
  return (
    <div>
      <div ref={containerRef} className={`${className} whitespace-pre-wrap`}>
        <AnimatePresence initial={false}>
          {textTokens.slice(0, visibleTokens).map((token, index) => (
            <motion.span
              key={`token-${index}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ 
                duration: 0.15,
                ease: "easeOut",
              }}
              className={`inline-block ${token === '\n' ? 'w-full' : ''}`}
              onAnimationComplete={() => {
                if (index === textTokens.length - 1) {
                  debugAnimation(`Animation completed for last token`);
                }
              }}
            >
              {token === '\n' ? <br /> : token}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      
      {/* Only show timestamp if requested and there's content */}
      {showTimestamp && visibleTokens === textTokens.length && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="mt-1 text-xs text-zinc-500"
        >
          {formatTime(timestamp)}
        </motion.div>
      )}
    </div>
  );
};

export default AnimatedResponse;
