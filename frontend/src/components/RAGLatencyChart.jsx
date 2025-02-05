import React from 'react';
import { Paper, Text } from '@mantine/core';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

const RAGLatencyChart = ({ currentScenario, stats }) => {
  // Get the appropriate latency based on the current scenario
  const getOLTPLatency = () => {
    if (!stats) return 80; // Default fallback value
    
    switch (currentScenario) {
      case 'direct':
        return stats.view.avg;
      case 'batch':
        return stats.materializeView.avg;
      case 'materialize':
      case 'cqrs':
        return stats.materialize.avg;
      default:
        return 80; // Default fallback value
    }
  };

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
      type: 'Parallel with Embedding Generation'
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
      latency: getOLTPLatency(),
      start: 10,
      type: 'Parallel with Vector DB Retrieval',
      highlight: true
    },
    { 
      name: 'Context Construction',
      spacing: Math.max(90, 10 + getOLTPLatency(), 60), // Start after both OLTP & Re-Ranking complete
      latency: 10,
      start: Math.max(90, 10 + getOLTPLatency(), 60),
      type: 'Sequential'
    },
    { 
      name: 'LLM Inference',
      spacing: Math.max(100, 20 + getOLTPLatency(), 70), // Start after Context Construction
      latency: 100,
      start: Math.max(100, 20 + getOLTPLatency(), 70),
      type: 'Sequential'
    },
    { 
      name: 'Post-processing & Response',
      spacing: Math.max(200, 120 + getOLTPLatency(), 170), // Start after LLM Inference
      latency: 15,
      start: Math.max(200, 120 + getOLTPLatency(), 170),
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
          <Text size="xs">Duration: {data.latency.toFixed(2)}ms</Text>
          <Text size="xs">End Time: {(data.start + data.latency).toFixed(2)}ms</Text>
          <Text size="xs">Type: {data.type}</Text>
          {data.highlight && (
            <Text size="xs" mt="xs" color={currentScenario === 'cqrs' ? 'teal' : 'orange'}>
              Using {
                currentScenario === 'direct' ? 'PostgreSQL View' :
                currentScenario === 'batch' ? 'Materialized View' :
                'Materialize'
              } latency
            </Text>
          )}
        </Paper>
      );
    }
    return null;
  };

  // Calculate the maximum X value for the domain based on the dynamic OLTP latency
  const maxX = Math.max(
    220,
    Math.max(215, 135 + getOLTPLatency(), 185), // End of last operation
    data.reduce((max, item) => {
      const endTime = item.start + item.latency;
      return endTime > max ? endTime : max;
    }, 0)
  );

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
            domain={[0, maxX]}
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
