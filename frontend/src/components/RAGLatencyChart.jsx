import React, { useRef } from 'react';
import { Paper, Text } from '@mantine/core';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

const RAGLatencyChart = ({ currentScenario, stats, includeOLTP }) => {
  // Keep track of the last valid latency value
  const lastValidLatencyRef = useRef(80);

  // Get the appropriate latency based on the current scenario
  const getOLTPLatency = () => {
    if (!stats) return lastValidLatencyRef.current;
    
    // Use shopping cart latency if available
    if (stats.shoppingCart?.avg != null) {
      lastValidLatencyRef.current = stats.shoppingCart.avg;
      return stats.shoppingCart.avg;
    }
    
    let latency;
    switch (currentScenario) {
      case 'direct':
        latency = stats.view?.avg;
        break;
      case 'batch':
        latency = stats.materializeView?.avg;
        break;
      case 'materialize':
      case 'cqrs':
        latency = stats.materialize?.avg;
        break;
      default:
        latency = null;
    }

    // If we got a valid latency, update our reference and return it
    if (latency != null && !isNaN(latency)) {
      lastValidLatencyRef.current = latency;
      return latency;
    }

    // Otherwise return the last known good value
    return lastValidLatencyRef.current;
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
    ...(includeOLTP ? [{
      name: 'OLTP Context Retrieval',
      spacing: 10,
      latency: getOLTPLatency(),
      start: 10,
      type: 'Parallel with Vector DB Retrieval',
      highlight: true
    }] : []),
    { 
      name: 'Context Construction',
      spacing: includeOLTP ? Math.max(60, 10 + getOLTPLatency()) : 60, // Start after the later of Re-Ranking (60ms) or OLTP end
      latency: 10,
      start: includeOLTP ? Math.max(60, 10 + getOLTPLatency()) : 60,
      type: 'Sequential'
    },
    { 
      name: 'LLM Inference',
      spacing: includeOLTP ? Math.max(70, 20 + getOLTPLatency()) : 70, // Previous end + 10ms
      latency: 100,
      start: includeOLTP ? Math.max(70, 20 + getOLTPLatency()) : 70,
      type: 'Sequential'
    },
    { 
      name: 'Post-processing & Response',
      spacing: includeOLTP ? Math.max(170, 120 + getOLTPLatency()) : 170, // Previous end + 100ms
      latency: 15,
      start: includeOLTP ? Math.max(170, 120 + getOLTPLatency()) : 170,
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
    includeOLTP ? 185 + getOLTPLatency() : 185, // End of last operation relative to OLTP
    data.reduce((max, item) => Math.max(max, item.start + item.latency), 0)
  );

  return (
    <div style={{ 
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      position: 'relative',
      padding: '0 8px'
    }}>
      <div style={{
        flex: 1,
        minHeight: 0,
        width: '100%'
      }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            barSize={12}
            margin={{ top: 25, right: 25, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
            <ReferenceLine
              x={200}
              stroke="#ff4d4f"
              strokeDasharray="3 3"
              label={{
                value: "Latency Budget (200ms)",
                position: "top",
                fill: "#ff4d4f",
                fontSize: 11,
                offset: -15
              }}
            />
            <XAxis 
              type="number" 
              domain={[0, maxX]}
              stroke="#BCB9C0"
              tickFormatter={(value) => `${value}ms`}
              tick={{ fontSize: 11 }}
            />
            <YAxis 
              type="category" 
              dataKey="name" 
              stroke="#BCB9C0"
              tick={{ fontSize: 11 }}
              width={120}
            />
            <Tooltip content={<CustomTooltip />} />
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
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.highlight ? '#9333EA' : 'rgba(156, 163, 175, 0.5)'} 
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default RAGLatencyChart; 
