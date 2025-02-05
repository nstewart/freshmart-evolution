import React, { useState, useEffect, useCallback } from 'react';
import { Paper, Text } from '@mantine/core';

// Custom hook for typewriter effect
const useTypewriter = (text, speed = 30) => {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    // Reset state when text changes
    setDisplayText('');
    setCurrentIndex(0);
    setIsTyping(true);
  }, [text]);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayText(text.slice(0, currentIndex + 1));
        setCurrentIndex(i => i + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else {
      setIsTyping(false);
    }
  }, [currentIndex, text, speed]);

  return { displayText, isTyping };
};

const RAGPromptResponse = ({ includeOLTP, currentMetric }) => {
  const prompt = "What are the current prices and inventory levels for organic apples?";
  
  const getResponse = () => {
    if (includeOLTP) {
      const price = currentMetric?.materialize_price?.toFixed(2) || '2.99';
      const latency = currentMetric?.materialize_end_to_end_latency 
        ? (currentMetric.materialize_end_to_end_latency / 1000).toFixed(1)
        : '0.1';
      
      return `Based on our real-time inventory data (as of ${latency} seconds ago), organic Red Delicious Apples are currently priced at $${price} per pound and are in stock. This price reflects current market conditions and inventory levels. The apples are certified organic and sourced from Washington State.`;
    } else {
      return `According to our knowledge base, organic Red Delicious Apples are typically priced between $2.49 and $3.99 per pound, with prices varying by season and location. For the most current pricing and inventory information, I recommend checking with your local store or our online ordering system.`;
    }
  };

  const response = getResponse();
  const { displayText, isTyping } = useTypewriter(response);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ flex: 1 }}>
        <Text size="sm" weight={500} mb="xs" style={{ color: '#BCB9C0' }}>User Prompt</Text>
        <Paper p="md" withBorder style={{ 
          backgroundColor: 'rgb(13, 17, 22)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          height: 'calc(100% - 2rem)'
        }}>
          <Text size="sm" style={{ color: '#BCB9C0', lineHeight: 1.6 }}>
            {prompt}
          </Text>
        </Paper>
      </div>

      <div style={{ flex: 1 }}>
        <Text size="sm" weight={500} mb="xs" style={{ color: '#BCB9C0' }}>
          LLM Response {includeOLTP ? '(with real-time data)' : '(from knowledge base)'}{isTyping && ' ...'}
        </Text>
        <Paper p="md" withBorder style={{ 
          backgroundColor: 'rgb(13, 17, 22)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          height: 'calc(100% - 2rem)'
        }}>
          <Text size="sm" style={{ color: '#BCB9C0', lineHeight: 1.6 }}>
            {displayText}
            {isTyping && <span style={{ borderRight: '2px solid #BCB9C0', animation: 'blink 1s step-end infinite' }} />}
          </Text>
        </Paper>
      </div>

      <style>
        {`
          @keyframes blink {
            from, to { border-color: transparent }
            50% { border-color: #BCB9C0 }
          }
        `}
      </style>
    </div>
  );
};

export default RAGPromptResponse; 