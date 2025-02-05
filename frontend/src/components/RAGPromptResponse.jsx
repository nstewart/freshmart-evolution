import React from 'react';
import { Paper, Text } from '@mantine/core';

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
          LLM Response {includeOLTP ? '(with real-time data)' : '(from knowledge base)'}
        </Text>
        <Paper p="md" withBorder style={{ 
          backgroundColor: 'rgb(13, 17, 22)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          height: 'calc(100% - 2rem)'
        }}>
          <Text size="sm" style={{ color: '#BCB9C0', lineHeight: 1.6 }}>
            {getResponse()}
          </Text>
        </Paper>
      </div>
    </div>
  );
};

export default RAGPromptResponse; 