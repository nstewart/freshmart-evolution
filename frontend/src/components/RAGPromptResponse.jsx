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
  const prompt = "When am I eligible for the next membership status?";
  
  const getResponse = () => {
    if (includeOLTP) {
      const latency = currentMetric?.materialize_end_to_end_latency 
        ? (currentMetric.materialize_end_to_end_latency / 1000).toFixed(1)
        : '0.1';
      
      return {
        parts: [
          'Based on your purchase history, you\'ve spent $892 this year and need just $108 more to reach Gold status. With the ',
          { text: 'current items in your cart', color: '#228be6' },
          ', you\'re going to reach Gold status at checkout!'
        ]
      };
    } else {
      return {
        parts: [
          'Based on our membership program guidelines, Gold status is achieved when you spend $1,000 or more within a calendar year. For your specific progress towards Gold status, I recommend checking your account dashboard for the most up-to-date information.'
        ]
      };
    }
  };

  const response = getResponse();
  const fullText = response.parts.map(part => typeof part === 'string' ? part : part.text).join('');
  const { displayText, isTyping } = useTypewriter(fullText);

  const renderColoredText = (text) => {
    let currentPosition = 0;
    const result = [];
    
    response.parts.forEach((part, index) => {
      if (typeof part === 'string') {
        const partLength = part.length;
        const partText = displayText.slice(currentPosition, currentPosition + partLength);
        result.push(<span key={index}>{partText}</span>);
        currentPosition += partLength;
      } else {
        const partLength = part.text.length;
        const partText = displayText.slice(currentPosition, currentPosition + partLength);
        result.push(<span key={index} style={{ color: part.color }}>{partText}</span>);
        currentPosition += partLength;
      }
    });

    return result;
  };

  return (
    <div style={{ 
      height: '300px',
      display: 'flex', 
      flexDirection: 'column', 
      gap: '0.5rem',
      overflow: 'hidden'
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <Text size="sm" weight={500} mb="xs" style={{ color: '#BCB9C0' }}>User Prompt</Text>
        <Paper p="xs" withBorder style={{ 
          backgroundColor: 'rgb(13, 17, 22)',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <Text size="sm" style={{ color: '#BCB9C0', lineHeight: 1.3 }}>
            {prompt}
          </Text>
        </Paper>
      </div>

      <div style={{ 
        flex: 1,
        display: 'flex', 
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <Text size="sm" weight={500} mb="xs" style={{ color: '#BCB9C0' }}>
          LLM Response {includeOLTP ? '(with real-time data)' : '(from knowledge base)'}{isTyping && ' ...'}
        </Text>
        <Paper p="xs" withBorder style={{ 
          backgroundColor: 'rgb(13, 17, 22)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          flex: 1,
          overflow: 'auto'
        }}>
          <Text size="sm" style={{ color: '#BCB9C0', lineHeight: 1.4 }}>
            {renderColoredText(displayText)}
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