import React, { useState, useEffect } from 'react';
import { Paper, Typography } from '@mui/material';
import { LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line, ResponsiveContainer } from 'recharts';

const PriceComparisonChart = () => {
  const [indexEnabled, setIndexEnabled] = useState(false);
  const [indexLoading, setIndexLoading] = useState(false);
  const [isolationLevel, setIsolationLevel] = useState('');
  const [isolationLoading, setIsolationLoading] = useState(false);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    if (metrics) {
      setIndexEnabled(metrics.index_enabled);
      setIsolationLevel(metrics.isolation_level);
    }
  }, [metrics]);

  const toggleIsolation = async () => {
    try {
      setIsolationLoading(true);
      const response = await fetch('/api/toggle-isolation', { method: 'POST' });
      const data = await response.json();
      if (data.status === 'success') {
        setIsolationLevel(data.isolation_level);
      }
    } catch (error) {
      console.error('Error toggling isolation:', error);
    } finally {
      setIsolationLoading(false);
    }
  };

  return (
    <div className="mb-4">
      <button
        className={`mr-2 px-4 py-2 rounded ${indexEnabled ? 'bg-red-500' : 'bg-green-500'} text-white`}
        onClick={toggleIsolation}
        disabled={isolationLoading}
      >
        {isolationLoading ? 'Loading...' : `Switch to ${isolationLevel === 'serializable' ? 'Strict Serializable' : 'Serializable'}`}
      </button>
      
      <div className="mb-4 text-sm text-gray-600">
        <p>Current Index Status: <span className="font-semibold">{indexEnabled ? 'Enabled' : 'Disabled'}</span></p>
        <p>Isolation Level: <span className="font-semibold capitalize">{isolationLevel}</span></p>
      </div>
    </div>
  );
};

const ReplicationChart = ({ metrics }) => {
  return (
    <Paper elevation={3} style={{ padding: '20px', marginTop: '20px' }}>
      <Typography variant="h6" gutterBottom>
        Replication and Refresh Status
      </Typography>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={metrics}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          connectNulls={false}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={['auto', 'auto']}
            tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString()}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis />
          <Tooltip
            labelFormatter={(label) => new Date(label).toLocaleString()}
            formatter={(value) => value !== null ? `${value.toFixed(2)}s` : 'N/A'}
          />
          <Legend />
          <Line
            name="PostgreSQL Materialized View Refresh Age"
            type="monotone"
            dataKey="materialized_view_freshness"
            stroke="#8884d8"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            name="Materialize Replication Lag"
            type="monotone"
            dataKey="materialize_freshness"
            stroke="#82ca9d"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Paper>
  );
};

export default PriceComparisonChart; 