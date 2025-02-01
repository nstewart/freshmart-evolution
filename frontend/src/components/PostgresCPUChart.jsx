import React, { useState, useEffect } from 'react';
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

const HISTORY_WINDOW_MS = 2 * 60 * 1000; // 2 minutes in milliseconds

const PostgresCPUChart = () => {
  const [cpuData, setCpuData] = useState([]);
  const maxDataPoints = 120; // 2 minutes of data points (1 per second)

  useEffect(() => {
    const fetchCPUStats = async () => {
      try {
        const response = await fetch('http://localhost:8000/postgres-cpu');
        const data = await response.json();
        
        // Add current time if timestamp is missing
        const timestamp = data.timestamp || Date.now();
        
        setCpuData(prevData => {
          const now = Date.now();
          // Filter out data points older than HISTORY_WINDOW_MS
          const filteredData = prevData.filter(d => (now - d.timestamp) <= HISTORY_WINDOW_MS);
          // Add new data point
          const newData = [...filteredData, { ...data, timestamp }];
          // Keep only the last maxDataPoints
          return newData.slice(-maxDataPoints);
        });
      } catch (error) {
        console.error('Error fetching CPU stats:', error);
      }
    };

    // Fetch initial data
    fetchCPUStats();

    // Set up polling interval
    const interval = setInterval(fetchCPUStats, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false 
    });
  };

  const chartData = {
    labels: cpuData.map(d => formatTime(d.timestamp)),
    datasets: [
      {
        label: 'PostgreSQL CPU Usage (%)',
        data: cpuData.map(d => d.cpu_usage),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
        fill: false,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        title: {
          display: true,
          text: 'CPU Usage (%)',
        },
      },
      x: {
        title: {
          display: true,
          text: 'Time',
        },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10
        }
      },
    },
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'PostgreSQL Container CPU Usage',
      },
      tooltip: {
        callbacks: {
          title: (context) => {
            return formatTime(cpuData[context[0].dataIndex].timestamp);
          },
          label: (context) => {
            return `CPU: ${context.raw.toFixed(1)}%`;
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

export default PostgresCPUChart; 
