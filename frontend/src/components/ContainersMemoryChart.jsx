import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const HISTORY_WINDOW_MS = 3 * 60 * 1000; // 3 minutes in milliseconds
const API_URL = 'http://localhost:8000'; // FastAPI backend URL

// Container memory limits in GB
const CONTAINER_MEMORY_LIMITS = {
  postgres: 4, // 4GB limit for PostgreSQL
  materialize: 4 // 4GB limit for Materialize
};

const ContainersMemoryChart = ({ scenarios }) => {
  const [memoryData, setMemoryData] = useState([]);
  const maxDataPoints = 180; // 3 minutes of data points (1 per second)

  // Convert percentage to GB
  const percentToGB = (percent, containerType) => {
    if (percent === null || percent === undefined) return null;
    const limit = CONTAINER_MEMORY_LIMITS[containerType];
    return (percent / 100) * limit;
  };

  useEffect(() => {
    const fetchMemoryStats = async () => {
      try {
        console.debug('Fetching memory stats...');
        const response = await axios.get(`${API_URL}/api/container-stats`);
        const data = response.data;
        console.debug('Received memory stats:', data);
        
        // Add current time if timestamp is missing
        const timestamp = data.timestamp || Date.now();
        
        // Only update if we have valid data for either container
        if (data.postgres_stats?.memory_usage !== null || data.materialize_stats?.memory_usage !== null) {
          console.debug('Updating memory data with valid stats');
          setMemoryData(prevData => {
            const now = Date.now();
            // Filter out data points older than HISTORY_WINDOW_MS
            const filteredData = prevData.filter(d => (now - d.timestamp) <= HISTORY_WINDOW_MS);
            
            // Convert percentages to GB
            const newDataPoint = {
              timestamp,
              postgres_memory_usage: percentToGB(data.postgres_stats?.memory_usage, 'postgres'),
              postgres_memory_stats: data.postgres_stats?.memory_stats ? {
                max: percentToGB(data.postgres_stats.memory_stats.max, 'postgres'),
                average: percentToGB(data.postgres_stats.memory_stats.average, 'postgres'),
                p99: percentToGB(data.postgres_stats.memory_stats.p99, 'postgres')
              } : null,
              materialize_memory_usage: percentToGB(data.materialize_stats?.memory_usage, 'materialize'),
              materialize_memory_stats: data.materialize_stats?.memory_stats ? {
                max: percentToGB(data.materialize_stats.memory_stats.max, 'materialize'),
                average: percentToGB(data.materialize_stats.memory_stats.average, 'materialize'),
                p99: percentToGB(data.materialize_stats.memory_stats.p99, 'materialize')
              } : null
            };

            const newData = [...filteredData, newDataPoint];
            console.debug('New memory data state:', newData);
            // Keep only the last maxDataPoints
            return newData.slice(-maxDataPoints);
          });
        } else {
          console.debug('Received null memory usage for both containers, skipping update');
        }
      } catch (error) {
        console.error('Error fetching memory stats:', error);
      }
    };

    // Fetch initial data
    fetchMemoryStats();

    // Set up polling interval
    const interval = setInterval(fetchMemoryStats, 5000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true 
    });
  };

  const chartData = {
    labels: memoryData.map(d => formatTime(d.timestamp)),
    datasets: [
      {
        label: 'PostgreSQL Memory Usage (GB)',
        data: memoryData.map(d => d.postgres_memory_usage),
        borderColor: '#ff7300',
        tension: 0.1,
        fill: false,
        dot: false,
        borderWidth: 2,
        spanGaps: true
      },
      ...(scenarios?.materialize ? [{
        label: 'Materialize Memory Usage (GB)',
        data: memoryData.map(d => d.materialize_memory_usage),
        borderColor: '#8884d8',
        tension: 0.1,
        fill: false,
        dot: false,
        borderWidth: 2,
        spanGaps: true
      }] : [])
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        left: 60,
        right: 30,
        top: 10,
        bottom: 10
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        suggestedMax: 4,
        title: {
          display: false
        },
        ticks: {
          callback: (value) => `${value.toFixed(1)} GB`,
          color: '#BCB9C0',
          font: {
            size: 14
          }
        },
        grid: {
          color: '#323135',
          drawBorder: false
        }
      },
      x: {
        title: {
          display: false
        },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10,
          color: '#BCB9C0',
          font: {
            size: 14
          }
        },
        grid: {
          color: '#323135',
          drawBorder: false
        }
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#BCB9C0',
          usePointStyle: true,
          pointStyle: 'line',
          font: {
            size: 14,
            family: 'Inter, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          },
          padding: 20
        }
      },
      title: {
        display: false
      },
      tooltip: {
        backgroundColor: 'rgb(13, 17, 22)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        titleColor: '#BCB9C0',
        bodyColor: '#BCB9C0',
        padding: 12,
        cornerRadius: 4,
        titleFont: {
          size: 14,
          family: 'Inter, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
        },
        bodyFont: {
          size: 14,
          family: 'Inter, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
        },
        callbacks: {
          title: (context) => {
            return formatTime(memoryData[context[0].dataIndex].timestamp);
          },
          label: (context) => {
            const datapoint = memoryData[context.dataIndex];
            const containerType = context.dataset.label.includes('PostgreSQL') ? 'postgres' : 'materialize';
            const usage = datapoint[`${containerType}_memory_usage`];
            const stats = datapoint[`${containerType}_memory_stats`];
            
            if (usage !== null && usage !== undefined) {
              return [
                `Current: ${usage?.toFixed(2)} GB`,
                stats ? `Average: ${stats.average?.toFixed(2)} GB` : null,
                stats ? `Max: ${stats.max?.toFixed(2)} GB` : null,
                stats ? `P99: ${stats.p99?.toFixed(2)} GB` : null
              ].filter(Boolean);
            }
            return null;
          }
        }
      }
    },
  };

  return (
    <div style={{ height: '400px', width: '100%', marginBottom: '20px' }}>
      <Line data={chartData} options={options} />
    </div>
  );
};

export default ContainersMemoryChart; 