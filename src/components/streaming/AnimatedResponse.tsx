'use client';

import React, { useRef, useEffect } from 'react';
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
  // If there's no text, don't render anything
  if (!text) return null;
  
  // Process text to preserve formatting
  // Instead of simple word splitting, handle whitespace preservation
  const processText = (text: string) => {
    // Preserve newlines by replacing them with a special marker
    const preserveNewlines = text.replace(/\n/g, ' \n ').replace(/\r/g, '');
    
    // Split by spaces but keep track of consecutive spaces
    const tokens = [];
    let currentToken = '';
    let inWhitespace = false;
    
    for (let i = 0; i < preserveNewlines.length; i++) {
      const char = preserveNewlines[i];
      
      if (char === ' ' || char === '\n') {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
        
        if (char === '\n') {
          tokens.push('\n');
        } else {
          tokens.push(' ');
        }
        
        inWhitespace = true;
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
  
  const textTokens = processText(text);
  
  // Reference to the last element for auto-scrolling
  const lastTokenRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to the latest word
  useEffect(() => {
    if (lastTokenRef.current && !isComplete) {
      lastTokenRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'end'  
      });
    }
  }, [text, isComplete]);

  // Format timestamp
  const formatTime = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Debug logging to help troubleshoot the animation
  useEffect(() => {
    debugAnimation(`Rendering ${textTokens.length} tokens, isComplete: ${isComplete}`, { 
      textLength: text.length,
      firstFewTokens: textTokens.slice(0, 3).join('')
    });
  }, [textTokens.length, isComplete, text]);
  
  return (
    <div>
      <div ref={containerRef} className={`${className} whitespace-pre-wrap`}>
        <AnimatePresence initial={false}>
          {textTokens.map((token, index) => (
            <motion.span
              key={`token-${index}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ 
                duration: 0.15,
                ease: "easeOut",
                delay: Math.min(0.03 * index, 1), // Cap delay at 1s for long responses
              }}
              className={`inline-block ${token === '\n' ? 'w-full' : ''}`}
              ref={index === textTokens.length - 1 ? lastTokenRef : undefined}
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
      {showTimestamp && (
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
