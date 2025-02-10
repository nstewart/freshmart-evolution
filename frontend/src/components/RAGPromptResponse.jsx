import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Paper, Text } from '@mantine/core';
import axios from 'axios';

// Custom hook for typewriter effect
const useTypewriter = (text, speed = 10, shouldTrigger) => {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const previousTriggerRef = useRef(shouldTrigger);

  useEffect(() => {
    // Only reset state when shouldTrigger changes from false to true
    if (shouldTrigger && !previousTriggerRef.current) {
      setDisplayText('');
      setCurrentIndex(0);
      setIsTyping(true);
    } else if (!shouldTrigger) {
      // When not animating, show full text immediately
      setDisplayText(text);
      setCurrentIndex(text.length);
      setIsTyping(false);
    }
    previousTriggerRef.current = shouldTrigger;
  }, [shouldTrigger, text]);

  useEffect(() => {
    if (currentIndex < text.length && isTyping) {
      const timer = setTimeout(() => {
        setDisplayText(text.slice(0, currentIndex + 1));
        setCurrentIndex(i => i + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else if (isTyping) {
      setIsTyping(false);
    }
  }, [currentIndex, text, speed, isTyping]);

  return { displayText, isTyping, isComplete: currentIndex >= text.length };
};

const RAGPromptResponse = ({ includeOLTP, currentMetric, currentScenario }) => {
  const prompt = "When am I eligible for the next membership status?";
  const [totalLatency, setTotalLatency] = useState(185);
  const lastValidLatencyRef = useRef(80);
  const lastScenarioRef = useRef(currentScenario);
  const lastValidLatenciesRef = useRef({
    direct: null,
    batch: null,
    materialize: null,
    cqrs: null
  });
  const [cartData, setCartData] = useState(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const previousOLTPRef = useRef(includeOLTP);

  // Fetch cart data
  useEffect(() => {
    const fetchCartData = async () => {
      try {
        const response = await axios.get('http://localhost:8000/api/shopping-cart');
        setCartData(response.data);
      } catch (error) {
        console.error('Error fetching cart data:', error);
      }
    };

    // Only fetch if we're in Materialize scenario and includeOLTP is true
    if ((currentScenario === 'materialize' || currentScenario === 'cqrs') && includeOLTP) {
      fetchCartData();
      const interval = setInterval(fetchCartData, 1000);
      return () => clearInterval(interval);
    }
  }, [currentScenario, includeOLTP]);

  useEffect(() => {
    if (previousOLTPRef.current !== includeOLTP) {
      setShouldAnimate(true);
    }
    previousOLTPRef.current = includeOLTP;
  }, [includeOLTP]);

  useEffect(() => {
    if (!includeOLTP) {
      setTotalLatency(185);
      return;
    }

    // Check if we just switched scenarios
    const isScenarioChange = lastScenarioRef.current !== currentScenario;
    lastScenarioRef.current = currentScenario;

    // Get the OLTP latency based on the current scenario
    let oltpLatency;
    let isWaiting = false;

    // Use the appropriate latency based on the current scenario
    switch (currentScenario) {
      case 'direct':
        oltpLatency = currentMetric?.view_latency;
        // Only show waiting if we just switched to this scenario and have no valid value yet
        if (isScenarioChange && lastValidLatenciesRef.current.direct === null) {
          isWaiting = true;
        }
        break;
      case 'batch':
        oltpLatency = currentMetric?.materialized_view_latency;
        if (isScenarioChange && lastValidLatenciesRef.current.batch === null) {
          isWaiting = true;
        }
        break;
      case 'materialize':
      case 'cqrs':
        oltpLatency = currentMetric?.materialize_latency;
        if (isScenarioChange && lastValidLatenciesRef.current.materialize === null) {
          isWaiting = true;
        }
        break;
      default:
        isWaiting = true;
    }

    // If we're waiting for initial data after a scenario change, show waiting state
    if (isWaiting) {
      setTotalLatency(null);
      return;
    }

    // If we don't have a current value, use the last valid one for this scenario
    if (oltpLatency === null || oltpLatency === undefined || isNaN(oltpLatency)) {
      oltpLatency = lastValidLatenciesRef.current[currentScenario];
      if (oltpLatency === null) {
        // If we still don't have a value, use the default
        oltpLatency = 80;
      }
    } else {
      // Update the last valid latency for this scenario
      lastValidLatenciesRef.current[currentScenario] = oltpLatency;
      if (currentScenario === 'materialize') {
        lastValidLatenciesRef.current.cqrs = oltpLatency; // Share values between materialize and cqrs
      }
    }

    // Calculate when LLM starts (must wait for both base operations and OLTP)
    const llmStart = Math.max(70, 20 + oltpLatency);

    // Total is when LLM finishes plus post-processing
    const newTotalLatency = llmStart + 100 + 15; // LLM (100ms) + post-processing (15ms)

    console.log('Current scenario:', currentScenario);
    console.log('Selected OLTP latency:', oltpLatency);
    console.log('Total latency:', newTotalLatency);

    setTotalLatency(newTotalLatency);
  }, [currentMetric, includeOLTP, currentScenario]);

  const getResponse = () => {
    if (!includeOLTP) {
      return {
        parts: [
          'Based on our membership program guidelines, Gold status is achieved when you spend $1,000 or more within a calendar year. For your specific progress towards Gold status, I recommend checking your account dashboard for the most up-to-date information.'
        ]
      };
    }

    if (currentScenario == 'batch') {
      return {
        parts: [
          'Based on your purchase history, you\'ve spent $892 this year and need just $108 more to reach Gold status.'
        ]
      }
    }

    // Calculate cart totals if we have cart data
    let cartItemCount = 0;
    let cartTotal = 0;
    if (cartData && cartData.cart_items) {
      cartItemCount = cartData.cart_items.length;
      cartTotal = cartData.cart_items.reduce((sum, item) => sum + Number(item.price), 0);
    }

    return {
      parts: [
        'Based on your purchase history, you\'ve spent $995 this year and need just $5 more to reach Gold status. With the',
        { text: ` current items in your cart (${cartItemCount} items totaling $${cartTotal.toFixed(2)})`, color: '#228be6' },
        ', you\'re going to reach Gold status at checkout!'
      ]
    };
  };

  const response = getResponse();
  const fullText = response.parts.map(part => typeof part === 'string' ? part : part.text).join('');
  const { displayText, isTyping, isComplete } = useTypewriter(fullText, 10, shouldAnimate);

  // Reset animation when complete
  useEffect(() => {
    if (isComplete && shouldAnimate) {
      const timer = setTimeout(() => {
        setShouldAnimate(false);
      }, 500); // Wait a bit after completion before resetting
      return () => clearTimeout(timer);
    }
  }, [isComplete, shouldAnimate]);

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

      <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '8px', marginTop: '4px' }}>
        <Text size="xs" style={{ color: '#BCB9C0' }}>
          Total Pipeline Latency:{' '}
          {totalLatency === null ? (
            <span style={{ color: '#BCB9C0', fontStyle: 'italic' }}>waiting...</span>
          ) : (
            <span style={{
              color: totalLatency <= 200 ? '#40c057' : '#fa5252',
              fontWeight: 500
            }}>
              {`${totalLatency.toFixed(1)}ms`}
            </span>
          )}
        </Text>
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