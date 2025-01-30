import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { MantineProvider, Container, TextInput, Button, Paper, Text, Group, Stack, Badge, LoadingOverlay, Slider, Image } from '@mantine/core';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

const HISTORY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const API_URL = 'http://localhost:8000'; // FastAPI backend URL

// Add CSS keyframes for the flash animation
const flashAnimation = {
  '@keyframes flash': {
    '0%': { backgroundColor: 'transparent' },
    '25%': { backgroundColor: '#fffbcc' },
    '100%': { backgroundColor: 'transparent' }
  }
};

function PriceDisplay({ price, prevPrice, reactionTime, weight = 700, size = "xl" }) {
  const priceRef = useRef(null);
  const lastReactionTimeRef = useRef(reactionTime);
  const lastUpdateTimeRef = useRef(Date.now());

  useEffect(() => {
    if (price !== prevPrice && priceRef.current) {
      priceRef.current.style.animation = 'none';
      // Trigger reflow
      void priceRef.current.offsetHeight;
      priceRef.current.style.animation = 'flash 1s ease';
    }
  }, [price, prevPrice]);

  useEffect(() => {
    if (reactionTime !== null && reactionTime !== undefined) {
      lastReactionTimeRef.current = reactionTime;
      lastUpdateTimeRef.current = Date.now();
    }
  }, [reactionTime]);

  // Calculate the extrapolated reaction time
  const getExtrapolatedReactionTime = () => {
    if (reactionTime !== null && reactionTime !== undefined) {
      return reactionTime;
    }
    if (lastReactionTimeRef.current === null || lastReactionTimeRef.current === undefined) {
      return null;
    }
    const timeSinceLastUpdate = (Date.now() - lastUpdateTimeRef.current);
    return lastReactionTimeRef.current + timeSinceLastUpdate;
  };

  const displayReactionTime = getExtrapolatedReactionTime();

  return (
    <Stack spacing={4} align="center">
      <Text 
        ref={priceRef}
        size={size} 
        weight={weight} 
        color="blue"
        style={{ 
          animation: 'none',
          '@keyframes flash': flashAnimation['@keyframes flash']
        }}
      >
        ${price?.toFixed(2) || 'N/A'}
      </Text>
      {displayReactionTime !== null && (
        <Text size="xs" color="dimmed">
          as of {(displayReactionTime / 1000).toFixed(1)} seconds ago
        </Text>
      )}
    </Stack>
  );
}

function getLagStatus(lag) {
  if (lag === null || lag === undefined) return { color: 'gray', label: 'Unknown' };
  if (lag < 1) return { color: 'green', label: 'Low' };
  if (lag < 5) return { color: 'yellow', label: 'Medium' };
  return { color: 'red', label: 'High' };
}

function calculateStats(values) {
  if (!values || values.length === 0) return { max: 0, avg: 0, p99: 0 };
  
  const sortedValues = [...values].sort((a, b) => a - b);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const p99Index = Math.floor(values.length * 0.99);
  const p99 = sortedValues[p99Index] || max;
  
  return {
    max: max * 1000, // Convert to ms
    avg: avg * 1000,
    p99: p99 * 1000
  };
}

function App() {
  const [metrics, setMetrics] = useState([]);
  const [error, setError] = useState(null);
  const [indexExists, setIndexExists] = useState(false);
  const [isIndexLoading, setIsIndexLoading] = useState(false);
  const [isPromotionLoading, setIsPromotionLoading] = useState(false);
  const [isolationLevel, setIsolationLevel] = useState('');
  const [isIsolationLoading, setIsIsolationLoading] = useState(false);
  const [isRefreshConfigLoading, setIsRefreshConfigLoading] = useState(false);
  const [databaseSize, setDatabaseSize] = useState(null);
  const [showTTCA, setShowTTCA] = useState(false);
  const [stats, setStats] = useState({
    view: { max: 0, avg: 0, p99: 0 },
    materializeView: { max: 0, avg: 0, p99: 0 },
    materialize: { max: 0, avg: 0, p99: 0 },
    mvRefresh: { max: 0, avg: 0, p99: 0 },
    viewEndToEnd: { max: 0, avg: 0, p99: 0 },
    materializeViewEndToEnd: { max: 0, avg: 0, p99: 0 },
    materializeEndToEnd: { max: 0, avg: 0, p99: 0 }
  });
  const [scenarios, setScenarios] = useState({
    postgres: true,
    materializeView: true,
    materialize: true
  });
  const productId = '1';
  const [isFetching, setIsFetching] = useState(false);
  const currentMetric = metrics[metrics.length - 1] || {};
  const lagStatus = getLagStatus(currentMetric.materialize_freshness);

  // Add refs for previous prices
  const prevPrices = useRef({
    view: null,
    materialized_view: null,
    materialize: null
  });

  // Update previous prices when current prices change
  useEffect(() => {
    if (currentMetric) {
      prevPrices.current = {
        view: currentMetric.view_price,
        materialized_view: currentMetric.materialized_view_price,
        materialize: currentMetric.materialize_price
      };
    }
  }, [currentMetric]);

  const toggleScenario = (scenario) => {
    setScenarios(prev => ({
      ...prev,
      [scenario]: !prev[scenario]
    }));
  };

  useEffect(() => {
    let isActive = true;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const POLL_INTERVAL = 1000; // Poll every second

    const fetchMetrics = async () => {
      if (!isActive || isFetching) return;
      
      try {
        setIsFetching(true);
        console.debug('Fetching metrics...');
        const response = await axios.get(`${API_URL}/metrics/${productId}`, {
          timeout: 300000, // 5 minutes timeout
          headers: {
            'Accept': 'application/json'
          }
        });
        
        // Reset retry count on success
        retryCount = 0;
        
        if (!response.data) {
          console.error('No data received from API');
          return;
        }

        const data = response.data;
        console.debug('Fetch response:', data);
        
        const now = Date.now();
        const timestamp = data.timestamp;
        
        setMetrics(prev => {
          const filtered = prev.filter(m => (now - m.timestamp) <= HISTORY_WINDOW_MS);
          
          // Get the last metric to access previous prices
          const lastMetric = filtered[filtered.length - 1] || {};
          
          const newMetric = {
            timestamp,
            isolation_level: data.isolation_level,
            // View data - retain previous price if new one is null
            view_latency: data.view_latency,
            view_end_to_end_latency: data.view_end_to_end_latency,
            view_price: data.view_price !== null ? data.view_price : lastMetric.view_price,
            view_qps: data.view_qps,
            view_stats: data.view_stats,
            view_end_to_end_stats: data.view_end_to_end_stats,
            // Materialized view data - retain previous price if new one is null
            materialized_view_latency: data.materialized_view_latency,
            materialized_view_end_to_end_latency: data.materialized_view_end_to_end_latency,
            materialized_view_price: data.materialized_view_price !== null ? data.materialized_view_price : lastMetric.materialized_view_price,
            materialized_view_qps: data.materialized_view_qps,
            materialized_view_freshness: data.materialized_view_freshness,
            materialized_view_refresh_duration: data.materialized_view_refresh_duration,
            materialized_view_stats: data.materialized_view_stats,
            materialized_view_end_to_end_stats: data.materialized_view_end_to_end_stats,
            materialized_view_refresh_stats: data.materialized_view_refresh_stats,
            // Materialize data - retain previous price if new one is null
            materialize_latency: data.materialize_latency,
            materialize_end_to_end_latency: data.materialize_end_to_end_latency,
            materialize_price: data.materialize_price !== null ? data.materialize_price : lastMetric.materialize_price,
            materialize_qps: data.materialize_qps,
            materialize_freshness: data.materialize_freshness,
            materialize_stats: data.materialize_stats,
            materialize_end_to_end_stats: data.materialize_end_to_end_stats
          };
          
          return [...filtered, newMetric];
        });
        
        // Update all stats at once
        setStats(prev => ({
          ...prev,
          view: data.view_stats ? {
            max: data.view_stats.max,
            avg: data.view_stats.average,
            p99: data.view_stats.p99
          } : prev.view,
          viewEndToEnd: data.view_end_to_end_stats ? {
            max: data.view_end_to_end_stats.max,
            avg: data.view_end_to_end_stats.average,
            p99: data.view_end_to_end_stats.p99
          } : prev.viewEndToEnd,
          materializeView: data.materialized_view_stats ? {
            max: data.materialized_view_stats.max,
            avg: data.materialized_view_stats.average,
            p99: data.materialized_view_stats.p99
          } : prev.materializeView,
          materializeViewEndToEnd: data.materialized_view_end_to_end_stats ? {
            max: data.materialized_view_end_to_end_stats.max,
            avg: data.materialized_view_end_to_end_stats.average,
            p99: data.materialized_view_end_to_end_stats.p99
          } : prev.materializeViewEndToEnd,
          materialize: data.materialize_stats ? {
            max: data.materialize_stats.max,
            avg: data.materialize_stats.average,
            p99: data.materialize_stats.p99
          } : prev.materialize,
          materializeEndToEnd: data.materialize_end_to_end_stats ? {
            max: data.materialize_end_to_end_stats.max,
            avg: data.materialize_end_to_end_stats.average,
            p99: data.materialize_end_to_end_stats.p99
          } : prev.materializeEndToEnd,
          mvRefresh: data.materialized_view_refresh_stats ? {
            max: data.materialized_view_refresh_stats.max * 1000, // Convert to ms
            avg: data.materialized_view_refresh_stats.average * 1000,
            p99: data.materialized_view_refresh_stats.p99 * 1000
          } : prev.mvRefresh
        }));
        
        setError(null);
      } catch (err) {
        console.error('Error fetching metrics:', err);
        
        // Handle connection errors with retries
        if (err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED') {
          retryCount++;
          if (retryCount <= MAX_RETRIES) {
            console.debug(`Retry attempt ${retryCount}/${MAX_RETRIES}`);
            const backoffDelay = 1000 * retryCount; // Exponential backoff
            setTimeout(fetchMetrics, backoffDelay);
            return;
          }
        }
        
        setError(err.response?.data?.detail || err.message);
      } finally {
        setIsFetching(false);
        // Schedule next poll
        if (isActive) {
          setTimeout(fetchMetrics, POLL_INTERVAL);
        }
      }
    };

    fetchMetrics();
    return () => {
      isActive = false;
    };
  }, [productId]);

  const togglePromotion = async () => {
    try {
      setIsPromotionLoading(true);
      const response = await axios.post(`${API_URL}/toggle-promotion/${productId}`, {
        timeout: 5000 // 5 second timeout
      });
      if (response.data.status === 'success') {
        setIsPromotionLoading(false);
      }
    } catch (err) {
      setError(err.message);
      console.error('Error toggling promotion:', err);
      setIsPromotionLoading(false);
    }
  };

  // Add function to fetch view index status
  const fetchViewIndexStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/view-index-status`);
      setIndexExists(response.data.index_exists);
    } catch (err) {
      console.error('Error fetching view index status:', err);
    }
  };

  // Add useEffect to fetch view index status on mount
  useEffect(() => {
    fetchViewIndexStatus();
  }, []);

  const toggleIndex = async () => {
    try {
      setIsIndexLoading(true);
      const response = await axios.post(`${API_URL}/toggle-view-index`);
      setIndexExists(response.data.index_exists);
      console.log('Index toggled:', response.data);
    } catch (err) {
      setError(err.message);
      console.error('Error toggling index:', err);
    } finally {
      setIsIndexLoading(false);
      // Fetch the latest status after toggling
      await fetchViewIndexStatus();
    }
  };

  const toggleIsolation = async () => {
    try {
      setIsIsolationLoading(true);
      const response = await axios.post(`${API_URL}/toggle-isolation`);
      if (response.data.status === 'success') {
        setIsolationLevel(response.data.isolation_level);
      }
    } catch (err) {
      setError(err.message);
      console.error('Error toggling isolation:', err);
    } finally {
      setIsIsolationLoading(false);
    }
  };

  const updateRefreshInterval = async (value) => {
    if (value < 1) return;
    try {
      setIsRefreshConfigLoading(true);
      const response = await axios.post(`${API_URL}/configure-refresh-interval/${value}`);
      if (response.data.status === 'success') {
        setRefreshInterval(value);
        console.debug(`Updated refresh interval to ${value} seconds`);
      }
    } catch (err) {
      setError(`Failed to update refresh interval: ${err.message}`);
      console.error('Error updating refresh interval:', err);
    } finally {
      setIsRefreshConfigLoading(false);
    }
  };

  useEffect(() => {
    if (metrics.length > 0) {
      const currentMetric = metrics[metrics.length - 1];
      setIsolationLevel(currentMetric.isolation_level);
    }
  }, [metrics]);

  // Add function to fetch database size
  const fetchDatabaseSize = async () => {
    try {
      const response = await axios.get(`${API_URL}/database-size`);
      setDatabaseSize(response.data.size_gb);
    } catch (err) {
      console.error('Error fetching database size:', err);
    }
  };

  // Add useEffect to fetch database size periodically
  useEffect(() => {
    fetchDatabaseSize();
    const interval = setInterval(fetchDatabaseSize, 60000); // Fetch every minute
    return () => clearInterval(interval);
  }, []);

  console.debug('Rendering with metrics length:', metrics.length);
  console.debug('Current metric:', currentMetric);
  console.debug('Current stats:', stats);

  // Add useEffect to fetch initial refresh interval
  useEffect(() => {
    const fetchRefreshInterval = async () => {
      try {
        const response = await axios.get(`${API_URL}/current-refresh-interval`);
        if (response.data.status === 'success') {
          setRefreshInterval(response.data.refresh_interval);
          console.debug(`Initialized refresh interval to ${response.data.refresh_interval} seconds`);
        }
      } catch (err) {
        console.error('Error fetching initial refresh interval:', err);
        // Keep the default value of 60 if fetch fails
      }
    };
    
    fetchRefreshInterval();
  }, []);  // Empty dependency array means this runs once on mount

  if (error) {
    console.error('Rendering error state:', error);
  }

  return (
    <MantineProvider>
      <Container size="lg" py="xl" style={{ position: 'relative' }}>
        <Stack spacing="xs" align="center" mb="xl">
          <Text size="xl" weight={700} style={{ fontSize: '2.5rem' }}>Freshmart</Text>
          <Text size="lg" color="dimmed">Live Data Products</Text>
          <Text size="md" color="dimmed" align="center" mt="md" style={{ maxWidth: '800px' }}>
            This demo shows the journey the team at Freshmart takes to deliver correct, dynamic prices to their customers while they are still engaging with their site.
          </Text>
        </Stack>
        <LoadingOverlay 
          visible={isIndexLoading || isPromotionLoading || isRefreshConfigLoading} 
          overlayBlur={2}
          loaderProps={{ size: 'xl', color: 'blue' }}
          overlayOpacity={0.7}
        />
        {error && (
          <Paper p="md" mb="md" style={{ backgroundColor: '#fff4f4' }}>
            <Text color="red">Error: {error}</Text>
          </Paper>
        )}
        <Stack spacing="md">
          <Group>
            <Button 
              onClick={togglePromotion} 
              variant="outline" 
              color="blue"
              disabled={isPromotionLoading}
            >
              {isPromotionLoading ? "Toggling Promotion..." : "Toggle Promotion"}
            </Button>
            <Button
              onClick={toggleIsolation}
              variant="outline"
              color="violet"
              disabled={isIsolationLoading}
            >
              {isIsolationLoading
                ? "Changing Isolation Level..."
                : `Switch to ${isolationLevel === 'serializable' ? 'Strict Serializable' : 'Serializable'}`
              }
            </Button>
          </Group>

          <Group spacing="md">
            <div>View Index: <Badge color={indexExists ? "green" : "red"}>{indexExists ? "Enabled" : "Disabled"}</Badge></div>
            <div>Isolation Level: <Badge color="violet" variant="light">{isolationLevel ? isolationLevel.replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown'}</Badge></div>
            <div>Database Size: <Badge color="blue" variant="light">{databaseSize ? `${databaseSize.toFixed(2)} GB` : 'Unknown'}</Badge></div>
          </Group>

          <Paper p="md" withBorder>
            <Text size="lg" weight={500} mb="md">Scenario Selection</Text>
            <Group>
              <Button
                onClick={() => toggleScenario('postgres')}
                variant={scenarios.postgres ? "filled" : "outline"}
                color="blue"
              >
                PostgreSQL View
              </Button>
              <Button
                onClick={() => toggleScenario('materializeView')}
                variant={scenarios.materializeView ? "filled" : "outline"}
                color="green"
              >
                Cached Table
              </Button>
              <Button
                onClick={() => toggleScenario('materialize')}
                variant={scenarios.materialize ? "filled" : "outline"}
                color="orange"
              >
                Materialize Query
              </Button>
              <Button
                onClick={() => setShowTTCA(!showTTCA)}
                variant={showTTCA ? "filled" : "outline"}
                color="gray"
              >
                Show Reaction Time
              </Button>
            </Group>
          </Paper>

          <Paper p="md" withBorder>
            <Text size="lg" weight={500} mb="md">Data Product Price Comparison</Text>
            <Text size="sm" color="dimmed" mb="lg" style={{ maxWidth: '800px' }}>
              Each data product is composed by joining data from multiple sources, these could be separate tables or separate databases entirely. Data products are made available to consumers ranging from web services to inventory systems.
            </Text>
            <Group position="apart">
              {scenarios.postgres && (
                <Paper shadow="sm" p={0} withBorder style={{ width: '30%' }}>
                  <Stack spacing={0}>
                    <div style={{ padding: '1rem' }}>
                      <Image
                        src="https://m.media-amazon.com/images/I/81XeVWWyUUL.jpg"
                        height={200}
                        fit="contain"
                        alt="Product"
                      />
                      <Text weight={500} align="center" size="sm" mt="md">Sony Alpha A6400 Mirrorless Camera with 16-50mm Lens</Text>
                      <Group position="center" mt="md">
                        <PriceDisplay 
                          price={currentMetric.view_price}
                          prevPrice={prevPrices.current.view}
                          reactionTime={currentMetric.view_end_to_end_latency}
                        />
                      </Group>
                    </div>
                    <Paper p="md" style={{ backgroundColor: '#edf2ff', borderTop: '1px solid #dee2e6' }}>
                      <Text weight={500} align="center" color="blue">PostgreSQL</Text>
                    </Paper>
                  </Stack>
                </Paper>
              )}
              {scenarios.materializeView && (
                <Paper shadow="sm" p={0} withBorder style={{ width: '30%' }}>
                  <Stack spacing={0}>
                    <div style={{ padding: '1rem' }}>
                      <Image
                        src="https://m.media-amazon.com/images/I/81XeVWWyUUL.jpg"
                        height={200}
                        fit="contain"
                        alt="Product"
                      />
                      <Text weight={500} align="center" size="sm" mt="md">Sony Alpha A6400 Mirrorless Camera with 16-50mm Lens</Text>
                      <Group position="center" mt="md" spacing="xs">
                        <PriceDisplay 
                          price={currentMetric.materialized_view_price}
                          prevPrice={prevPrices.current.materialized_view}
                          reactionTime={currentMetric.materialized_view_end_to_end_latency}
                        />
                      </Group>
                    </div>
                    <Paper p="md" style={{ backgroundColor: '#e9fef0', borderTop: '1px solid #dee2e6' }}>
                      <Text weight={500} align="center" color="green">Cache</Text>
                    </Paper>
                  </Stack>
                </Paper>
              )}
              {scenarios.materialize && (
                <Paper shadow="sm" p={0} withBorder style={{ width: '30%' }}>
                  <Stack spacing={0}>
                    <div style={{ padding: '1rem' }}>
                      <Image
                        src="https://m.media-amazon.com/images/I/81XeVWWyUUL.jpg"
                        height={200}
                        fit="contain"
                        alt="Product"
                      />
                      <Text weight={500} align="center" size="sm" mt="md">Sony Alpha A6400 Mirrorless Camera with 16-50mm Lens</Text>
                      <Group position="center" mt="md" spacing="xs">
                        <PriceDisplay 
                          price={currentMetric.materialize_price}
                          prevPrice={prevPrices.current.materialize}
                          reactionTime={currentMetric.materialize_end_to_end_latency}
                        />
                      </Group>
                    </div>
                    <Paper p="md" style={{ backgroundColor: '#fff4e6', borderTop: '1px solid #dee2e6' }}>
                      <Text weight={500} align="center" color="orange">Materialize</Text>
                    </Paper>
                  </Stack>
                </Paper>
              )}
            </Group>
          </Paper>

          <Paper p="md" withBorder>
            <LoadingOverlay visible={isPromotionLoading} opacity={0.5} />
            <Group position="apart" mb="md">
              <Text size="lg" weight={500}>Query Statistics</Text>
            </Group>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Source</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Query Latency Max</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Query Latency Avg</th>
                  <th style={{ textAlign: 'right', padding: '8px' }}>Query Latency P99</th>
                  {showTTCA && (
                    <>
                      <th style={{ textAlign: 'right', padding: '8px' }}>RT Max</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>RT Avg</th>
                      <th style={{ textAlign: 'right', padding: '8px' }}>RT P99</th>
                    </>
                  )}
                  <th style={{ textAlign: 'right', padding: '8px' }}>QPS</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.postgres && (
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>PostgreSQL View</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.view.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.view.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.view.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    {showTTCA && (
                      <>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.viewEndToEnd.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.viewEndToEnd.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.viewEndToEnd.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      </>
                    )}
                    <td style={{ textAlign: 'right', padding: '8px' }}>{currentMetric.view_qps?.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) || '0.0'}</td>
                  </tr>
                )}
                {scenarios.materializeView && (
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>Cached Table</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeView.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeView.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeView.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    {showTTCA && (
                      <>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeViewEndToEnd.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeViewEndToEnd.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeViewEndToEnd.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      </>
                    )}
                    <td style={{ textAlign: 'right', padding: '8px' }}>{currentMetric.materialized_view_qps?.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) || '0.0'}</td>
                  </tr>
                )}
                {scenarios.materialize && (
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>Materialize</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materialize.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materialize.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materialize.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    {showTTCA && (
                      <>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeEndToEnd.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeEndToEnd.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeEndToEnd.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      </>
                    )}
                    <td style={{ textAlign: 'right', padding: '8px' }}>{currentMetric.materialize_qps?.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) || '0.0'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Paper>

          <Paper p="md" withBorder>
            <Text size="lg" weight={500} mb="md">Query Latency</Text>
            <LineChart width={800} height={200} data={metrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                scale="time"
                interval="preserveStartEnd"
                minTickGap={50}
              />
              <YAxis />
              <Tooltip
                labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                formatter={(value) => `${value?.toFixed(2)}ms`}
              />
              <Legend />
              {scenarios.postgres && (
                <Line
                  type="monotone"
                  dataKey="view_latency"
                  name="PostgreSQL View Latency"
                  stroke="#8884d8"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
              {scenarios.materializeView && (
                <Line
                  type="monotone"
                  dataKey="materialized_view_latency"
                  name="Cached Table Latency"
                  stroke="#82ca9d"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
              {scenarios.materialize && (
                <Line
                  type="monotone"
                  dataKey="materialize_latency"
                  name="Materialize Latency"
                  stroke="#ff7300"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
            </LineChart>
          </Paper>

          <Paper p="md" withBorder>
            <Group position="apart" mb="md">
              <Text size="lg" weight={500}>Replication and Refresh Status</Text>
              <Group>
                {scenarios.materialize && (
                  <Group>
                    <div>Current Replication Lag:</div>
                    <Badge color={lagStatus.color} size="lg" variant="filled">
                      {currentMetric.materialize_freshness?.toFixed(3)}s ({lagStatus.label})
                    </Badge>
                  </Group>
                )}
                {scenarios.materializeView && (
                  <Group>
                    <div>Cache Rehydration Time Stats:</div>
                    <Text size="sm">
                      Max: {stats.mvRefresh.max.toFixed(2)}ms | 
                      Avg: {stats.mvRefresh.avg.toFixed(2)}ms | 
                      P99: {stats.mvRefresh.p99.toFixed(2)}ms
                    </Text>
                  </Group>
                )}
              </Group>
            </Group>
            <LineChart width={800} height={200} data={metrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                scale="time"
                interval="preserveStartEnd"
                minTickGap={50}
              />
              <YAxis />
              <Tooltip
                labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                formatter={(value) => `${value?.toFixed(3) || 'N/A'}s`}
              />
              <Legend />
              {scenarios.materializeView && (
                <Line
                  type="monotone"
                  dataKey="materialized_view_freshness"
                  name="Cached Table Refresh Age"
                  stroke="#82ca9d"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
              {scenarios.materialize && (
                <Line
                  type="monotone"
                  dataKey="materialize_freshness"
                  name="Materialize Replication Lag"
                  stroke="#ff7300"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )}
            </LineChart>
          </Paper>

          {showTTCA && (
            <Paper p="md" withBorder>
              <Text size="lg" weight={500} mb="md">Reaction Time</Text>
              <LineChart width={800} height={200} data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                  scale="time"
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
                  formatter={(value) => `${value?.toFixed(2) || 'N/A'}ms`}
                />
                <Legend />
                {scenarios.postgres && (
                  <Line
                    type="monotone"
                    dataKey="view_end_to_end_latency"
                    name="PostgreSQL View Reaction Time"
                    stroke="#8884d8"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={true}
                  />
                )}
                {scenarios.materializeView && (
                  <Line
                    type="monotone"
                    dataKey="materialized_view_end_to_end_latency"
                    name="Cached Table Reaction Time"
                    stroke="#82ca9d"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={true}
                  />
                )}
                {scenarios.materialize && (
                  <Line
                    type="monotone"
                    dataKey="materialize_end_to_end_latency"
                    name="Materialize Reaction Time"
                    stroke="#ff7300"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={true}
                  />
                )}
              </LineChart>
            </Paper>
          )}
        </Stack>
      </Container>
    </MantineProvider>
  );
}

export default App;
