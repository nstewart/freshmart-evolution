import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const HISTORY_WINDOW_MS = 3 * 60 * 1000; // 3 minutes in milliseconds
const API_URL = 'http://localhost:8000'; // FastAPI backend URL

const ContainersCPUChart = ({ scenarios }) => {
  const [cpuData, setCpuData] = useState([]);
  const maxDataPoints = 180; // 3 minutes of data points (1 per second)

  useEffect(() => {
    const fetchCPUStats = async () => {
      try {
        console.debug('Fetching CPU stats...');
        const response = await axios.get(`${API_URL}/api/container-stats`);
        const data = response.data;
        console.debug('Received CPU stats:', data);
        
        // Add current time if timestamp is missing
        const timestamp = data.timestamp || Date.now();
        
        // Only update if we have valid data for either container
        if (data.postgres_stats?.cpu_usage !== null || data.materialize_stats?.cpu_usage !== null) {
          console.debug('Updating CPU data with valid stats');
          setCpuData(prevData => {
            const now = Date.now();
            // Filter out data points older than HISTORY_WINDOW_MS
            const filteredData = prevData.filter(d => (now - d.timestamp) <= HISTORY_WINDOW_MS);
            // Add new data point
            const newData = [...filteredData, { 
              timestamp,
              postgres_cpu_usage: data.postgres_stats?.cpu_usage,
              postgres_cpu_stats: data.postgres_stats?.cpu_stats,
              materialize_cpu_usage: data.materialize_stats?.cpu_usage,
              materialize_cpu_stats: data.materialize_stats?.cpu_stats
            }];
            console.debug('New CPU data state:', newData);
            // Keep only the last maxDataPoints
            return newData.slice(-maxDataPoints);
          });
        } else {
          console.debug('Received null CPU usage for both containers, skipping update');
        }
      } catch (error) {
        console.error('Error fetching CPU stats:', error);
      }
    };

    // Fetch initial data
    fetchCPUStats();

    // Set up polling interval
    const interval = setInterval(fetchCPUStats, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={cpuData}
          margin={{ left: 60, right: 30, top: 10, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#323135" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
            scale="time"
            interval="preserveStartEnd"
            minTickGap={50}
            stroke="#BCB9C0"
          />
          <YAxis
            stroke="#BCB9C0"
            domain={[0, dataMax => Math.max(400, Math.ceil(dataMax * 1.1))]}
            tickFormatter={(value) => `${value}%`}
            allowDataOverflow={true}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(13, 17, 22)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              color: '#BCB9C0',
              padding: '12px',
              fontSize: '14px',
              fontFamily: 'Inter, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
            }}
            labelStyle={{ color: '#BCB9C0' }}
            labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
            formatter={(value, name) => {
              if (value === null || value === undefined) return ['N/A'];
              const containerType = name.includes('PostgreSQL') ? 'postgres' : 'materialize';
              const dataPoint = cpuData.find(d => d[`${containerType}_cpu_usage`] === value);
              const stats = dataPoint?.[`${containerType}_cpu_stats`];
              
              return [
                [`Current: ${value.toFixed(1)}%`],
                stats && [
                  `Average: ${stats.average?.toFixed(1)}%`,
                  `Max: ${stats.max?.toFixed(1)}%`,
                  `P99: ${stats.p99?.toFixed(1)}%`
                ]
              ].flat().filter(Boolean);
            }}
          />
          <Legend
            wrapperStyle={{
              color: '#BCB9C0',
              fontFamily: 'Inter, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '14px',
              paddingTop: '20px'
            }}
            verticalAlign="bottom"
            height={36}
          />
          <Line
            type="monotone"
            dataKey="postgres_cpu_usage"
            name="PostgreSQL CPU Usage"
            stroke="#ff7300"
            dot={false}
            isAnimationActive={false}
            connectNulls={true}
            strokeWidth={2}
          />
          {scenarios?.materialize && (
            <Line
              type="monotone"
              dataKey="materialize_cpu_usage"
              name="Materialize CPU Usage"
              stroke="#8884d8"
              dot={false}
              isAnimationActive={false}
              connectNulls={true}
              strokeWidth={2}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ContainersCPUChart; 
