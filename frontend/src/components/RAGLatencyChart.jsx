import React from 'react';
import { Paper, Text } from '@mantine/core';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

const RAGLatencyChart = () => {
  // Data for the waterfall chart with proper start times for parallel execution
  const data = [
    { 
      name: 'User Request Handling',
      spacing: 0,
      latency: 10,
      start: 0,
      type: 'Sequential'
    },
    { 
      name: 'Embedding Generation',
      spacing: 10,
      latency: 15,
      start: 10,
      type: 'Sequential'
    },
    { 
      name: 'Vector DB Retrieval',
      spacing: 10,
      latency: 30,
      start: 10,
      type: 'Parallel'
    },
    { 
      name: 'Re-Ranking',
      spacing: 40,
      latency: 20,
      start: 40,
      type: 'Sequential'
    },
    { 
      name: 'OLTP Context Retrieval',
      spacing: 10,
      latency: 80,
      start: 10,
      type: 'Parallel',
      highlight: true
    },
    { 
      name: 'Context Construction',
      spacing: 90,
      latency: 10,
      start: 90,
      type: 'Sequential'
    },
    { 
      name: 'LLM Inference',
      spacing: 100,
      latency: 100,
      start: 100,
      type: 'Sequential'
    },
    { 
      name: 'Post-processing & Response',
      spacing: 200,
      latency: 15,
      start: 200,
      type: 'Sequential'
    }
  ];

  // Custom tooltip content
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[payload.length - 1].payload;
      return (
        <Paper p="xs" style={{ 
          backgroundColor: 'rgb(13, 17, 22)', 
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#BCB9C0' 
        }}>
          <Text size="sm">{data.name}</Text>
          <Text size="xs">Start Time: {data.start}ms</Text>
          <Text size="xs">Duration: {data.latency}ms</Text>
          <Text size="xs">End Time: {data.start + data.latency}ms</Text>
          <Text size="xs">Type: {data.type}</Text>
        </Paper>
      );
    }
    return null;
  };

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 20, right: 30, left: 200, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
          <XAxis 
            type="number" 
            domain={[0, 220]}
            stroke="#BCB9C0"
            tickFormatter={(value) => `${value}ms`}
          />
          <YAxis 
            type="category" 
            dataKey="name" 
            stroke="#BCB9C0"
            width={180}
            style={{
              fontSize: '12px',
              fill: '#BCB9C0',
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar 
            dataKey="spacing" 
            stackId="a" 
            fill="transparent" 
          />
          <Bar 
            dataKey="latency" 
            stackId="a" 
            background={{ fill: 'rgba(255, 255, 255, 0.05)' }}
          >
            {
              data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.highlight ? '#ff7300' : 'rgba(136, 132, 216, 0.6)'} 
                />
              ))
            }
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RAGLatencyChart; 
