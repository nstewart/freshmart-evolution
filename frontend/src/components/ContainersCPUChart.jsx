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
    labels: cpuData.map(d => formatTime(d.timestamp)),
    datasets: [
      {
        label: 'PostgreSQL CPU Usage (%)',
        data: cpuData.map(d => d.postgres_cpu_usage),
        borderColor: '#ff7300',
        tension: 0.1,
        fill: false,
        dot: false,
        borderWidth: 2,
        pointRadius: 0
      },
      ...(scenarios?.materialize ? [{
        label: 'Materialize CPU Usage (%)',
        data: cpuData.map(d => d.materialize_cpu_usage),
        borderColor: '#8884d8',
        tension: 0.1,
        fill: false,
        dot: false,
        borderWidth: 2,
        pointRadius: 0
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
        suggestedMax: 400,
        title: {
          display: false
        },
        ticks: {
          callback: (value) => `${value}%`,
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
            return formatTime(cpuData[context[0].dataIndex].timestamp);
          },
          label: (context) => {
            const datapoint = cpuData[context.dataIndex];
            const containerType = context.dataset.label.includes('PostgreSQL') ? 'postgres' : 'materialize';
            const usage = datapoint[`${containerType}_cpu_usage`];
            const stats = datapoint[`${containerType}_cpu_stats`];
            
            if (usage !== null && usage !== undefined) {
              return [
                `Current: ${usage?.toFixed(1)}%`,
                stats ? `Average: ${stats.average?.toFixed(1)}%` : null,
                stats ? `Max: ${stats.max?.toFixed(1)}%` : null,
                stats ? `P99: ${stats.p99?.toFixed(1)}%` : null
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

export default ContainersCPUChart; 
