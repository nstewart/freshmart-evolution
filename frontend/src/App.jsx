import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { MantineProvider, Container, TextInput, Button, Paper, Text, Group, Stack, Badge, LoadingOverlay, Slider, Image, Accordion, Grid, Divider, Select } from '@mantine/core';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import ContainersCPUChart from './components/ContainersCPUChart.jsx';

const HISTORY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const API_URL = 'http://localhost:8000'; // FastAPI backend URL

const theme = {
  colorScheme: 'light',
  fontFamily: 'Inter, sans-serif',
  headings: {
    fontFamily: 'Inter, sans-serif',
  },
  components: {
    Paper: {
      defaultProps: {
        shadow: 'sm',
        radius: 'md',
        withBorder: true,
      }
    },
    Button: {
      defaultProps: {
        radius: 'md',
      }
    },
    Container: {
      defaultProps: {
        size: 'xl',
      }
    }
  },
  colors: {
    brand: [
      '#eef2ff',
      '#e0e7ff',
      '#c7d2fe',
      '#a5b4fc',
      '#818cf8',
      '#6366f1',
      '#4f46e5',
      '#4338ca',
      '#3730a3',
      '#312e81',
    ],
  },
};

// Add CSS keyframes for the flash animation
const flashAnimation = {
  '@keyframes flash': {
    '0%': { backgroundColor: 'transparent' },
    '25%': { backgroundColor: '#fffbcc' },
    '100%': { backgroundColor: 'transparent' }
  }
};

// Add styles for the entity relationship graph
const graphStyles = {
  node: {
    base: {
      padding: '8px 16px',
      borderRadius: '4px',
      border: '1px solid #dee2e6',
      backgroundColor: 'white',
      display: 'inline-block',
      fontSize: '14px',
      fontWeight: 500,
      margin: '4px',
      position: 'relative',
      minWidth: '140px'
    },
    products: { borderColor: '#228be6', color: '#228be6' },
    sales: { borderColor: '#40c057', color: '#40c057' },
    promotions: { borderColor: '#fd7e14', color: '#fd7e14' },
    inventory: { borderColor: '#7950f2', color: '#7950f2' },
    categories: { borderColor: '#be4bdb', color: '#be4bdb' },
    view: { borderColor: '#1c7ed6', color: '#1c7ed6', borderWidth: '2px' }
  },
  line: {
    position: 'absolute',
    backgroundColor: '#dee2e6',
    zIndex: 0
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
    materializeView: false,
    materialize: false
  });
  const [trafficEnabled, setTrafficEnabled] = useState({
    postgres: true,
    materializeView: false,
    materialize: false
  });
  const productId = '1';
  const [isFetching, setIsFetching] = useState(false);
  const currentMetric = metrics[metrics.length - 1] || {};
  const lagStatus = getLagStatus(currentMetric.materialize_freshness);
  const [currentScenario, setCurrentScenario] = useState('direct'); // Options: direct, batch, materialize, cqrs

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

  const handleScenarioChange = async (scenario) => {
    setCurrentScenario(scenario);
    
    // Configure scenarios and traffic based on selection
    switch (scenario) {
      case 'direct':
        // Direct View Queries
        setScenarios({
          postgres: true,
          materializeView: false,
          materialize: false
        });
        if (!trafficEnabled.postgres) await handleTrafficToggle('postgres');
        if (trafficEnabled.materializeView) await handleTrafficToggle('materializeView');
        if (trafficEnabled.materialize) await handleTrafficToggle('materialize');
        break;
      
      case 'batch':
        // Add Batch Computation
        setScenarios({
          postgres: true,
          materializeView: true,
          materialize: false
        });
        if (!trafficEnabled.postgres) await handleTrafficToggle('postgres');
        if (!trafficEnabled.materializeView) await handleTrafficToggle('materializeView');
        if (trafficEnabled.materialize) await handleTrafficToggle('materialize');
        break;
      
      case 'materialize':
        // Add Materialize
        setScenarios({
          postgres: true,
          materializeView: true,
          materialize: true
        });
        if (!trafficEnabled.postgres) await handleTrafficToggle('postgres');
        if (!trafficEnabled.materializeView) await handleTrafficToggle('materializeView');
        if (!trafficEnabled.materialize) await handleTrafficToggle('materialize');
        break;
      
      case 'cqrs':
        // Full Query Offload (CQRS)
        setScenarios({
          postgres: false,
          materializeView: false,
          materialize: true
        });
        if (trafficEnabled.postgres) await handleTrafficToggle('postgres');
        if (trafficEnabled.materializeView) await handleTrafficToggle('materializeView');
        if (!trafficEnabled.materialize) await handleTrafficToggle('materialize');
        break;
    }
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

  // Update handleTrafficToggle to use the new endpoint
  const handleTrafficToggle = async (source) => {
    try {
      // Map frontend source names to backend source names
      const sourceMapping = {
        'postgres': 'view',
        'materializeView': 'materialized_view',
        'materialize': 'materialize'
      };

      const backendSource = sourceMapping[source];
      if (!backendSource) {
        console.error(`Invalid source name: ${source}`);
        return;
      }

      const response = await axios.post(`${API_URL}/api/toggle-traffic/${backendSource}`);
      
      // After toggle, fetch the current state to ensure we're in sync
      const stateResponse = await axios.get(`${API_URL}/api/traffic-state`);
      setTrafficEnabled({
        postgres: stateResponse.data.view,
        materializeView: stateResponse.data.materialized_view,
        materialize: stateResponse.data.materialize
      });
    } catch (err) {
      console.error('Error toggling traffic:', err);
      setError(`Failed to toggle ${source} traffic: ${err.message}`);
      
      // On error, refresh the state to ensure we're in sync
      try {
        const stateResponse = await axios.get(`${API_URL}/api/traffic-state`);
        setTrafficEnabled({
          postgres: stateResponse.data.view,
          materializeView: stateResponse.data.materialized_view,
          materialize: stateResponse.data.materialize
        });
      } catch (stateErr) {
        console.error('Error fetching traffic state after toggle error:', stateErr);
      }
    }
  };

  // Add useEffect to fetch initial traffic state and set up periodic refresh
  useEffect(() => {
    const fetchTrafficState = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/traffic-state`);
        setTrafficEnabled({
          postgres: response.data.view,
          materializeView: response.data.materialized_view,
          materialize: response.data.materialize
        });
      } catch (err) {
        console.error('Error fetching traffic state:', err);
      }
    };

    // Fetch initial state
    fetchTrafficState();

    // Set up periodic refresh every 2 seconds
    const interval = setInterval(fetchTrafficState, 2000);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, []);  // Empty dependency array means this runs once on mount

  if (error) {
    console.error('Rendering error state:', error);
  }

  return (
    <MantineProvider theme={theme}>
      <Container size="xl" py="xl">
        <Stack spacing="lg">
          <Paper p="xl" withBorder={false} style={{ 
            background: 'linear-gradient(-45deg, #4f46e5, #6366f1, #818cf8, #4f46e5)',
            backgroundSize: '400% 400%',
            animation: 'gradient 15s ease infinite'
          }}>
            <Grid>
              <Grid.Col span={8}>
                <Stack spacing="xs">
                  <Stack spacing={0}>
                    <Text size="xl" weight={700} style={{ fontSize: '2rem', letterSpacing: '-0.02em', color: 'white', lineHeight: 1.2 }}>
                      Real-time Data
                    </Text>
                    <Text size="xl" weight={700} style={{ fontSize: '2rem', letterSpacing: '-0.02em', color: 'white', lineHeight: 1.2 }}>
                      Integration and Transformation
                    </Text>
                  </Stack>
                  <Text size="lg" style={{ color: 'rgba(255, 255, 255, 0.9)', marginBottom: '0.5rem' }}>
                    Use SQL to create live data products you can trust
                  </Text>
                </Stack>
              </Grid.Col>
            </Grid>
          </Paper>

          <Paper p="xl" withBorder style={{ 
            backgroundColor: 'white',
            borderLeft: '4px solid #4f46e5',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <Group>
              <div style={{ flex: 1 }}>
                <Text 
                  size="lg" 
                  style={{ 
                    color: '#1a1a1a', 
                    lineHeight: 1.6,
                    fontWeight: 500,
                    maxWidth: '800px',
                    margin: '0 auto',
                    textAlign: 'center'
                  }}
                >
                  How can you make trustworthy, transformed data available throughout your systems and teams, while it's still fresh?
                </Text>
              </div>
            </Group>
          </Paper>

          <Paper p="xl" withBorder style={{ backgroundColor: 'white' }}>
            <Stack spacing="md">
              <Text size="lg" weight={600} style={{ color: '#1a1a1a' }}>Select a Scenario</Text>
              <Select
                value={currentScenario}
                onChange={handleScenarioChange}
                data={[
                  { value: 'direct', label: 'Direct View Queries' },
                  { value: 'batch', label: 'Add Batch Computation' },
                  { value: 'materialize', label: 'Add Materialize' },
                  { value: 'cqrs', label: 'Full Query Offload (CQRS)' }
                ]}
                style={{ maxWidth: '400px' }}
                required
                clearable={false}
              />
            </Stack>
          </Paper>

          <Paper p="xl" className="hover-card">
            <Text size="lg" weight={600} mb="md" style={{ color: '#1a1a1a' }}>Data Product Price Comparison</Text>
            <Text size="sm" color="dimmed" mb="lg" style={{ maxWidth: '800px', lineHeight: '1.6' }}>
              Each data product is composed by joining data from multiple sources, these could be separate tables or separate databases entirely. Data products are made available to consumers ranging from web services to inventory systems.
            </Text>
            
            <Paper p="lg" mb="lg" style={{ backgroundColor: '#f8fafc' }}>
              <Accordion styles={{
                control: {
                  borderBottom: 'none'
                },
                item: {
                  borderBottom: 'none'
                }
              }}>
                <Accordion.Item value="dataflow">
                  <Accordion.Control>
                    <Text weight={500}>Data Lineage</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <pre style={{ 
                      fontFamily: 'Inter, monospace',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre',
                      overflow: 'auto',
                      padding: '20px',
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid rgba(0, 0, 0, 0.05)'
                    }}>
{`
   Categories ──┐
                └──► Popularity Score ──┐
      Sales ────┐                       │
         │      └──► Recent Prices ─────┤
         │                              │
         └────► High Demand ────────────┤
                                        │
    Products ───┐                       ├──► Inventory Item
                ├──► Inventory Status  ─┘
                │                       │
   Promotions ──┴──► Promotion Effect  ─┘
   
`} 
   <span 
     onClick={togglePromotion} 
     style={{ color: 'blue', cursor: 'pointer', textDecoration: 'underline' }}
   >
     (Toggle)
   </span>

</pre>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Paper>

            <Group position="apart" grow>
              {scenarios.postgres && (
                <Paper p={0} className="hover-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '20px' }}>
                      <Image
                        src="https://i5.walmartimages.com/seo/Fresh-Red-Delicious-Apple-Each_7320e63a-de46-4a16-9b8c-526e15219a12_3.e557c1ad9973e1f76f512b34950243a3.jpeg?odnHeight=768&odnWidth=768&odnBg=FFFFFF"
                        height={200}
                        fit="contain"
                        alt="Product"
                      />
                      <Text weight={500} align="center" size="sm" mt="md">Fresh Red Delicious Apple</Text>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '20px' }}>
                      <PriceDisplay 
                        price={currentMetric.view_price}
                        prevPrice={prevPrices.current.view}
                        reactionTime={currentMetric.view_end_to_end_latency}
                      />
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid #eee', padding: '15px' }}>
                    <Text weight={500} align="center" color="blue">PostgreSQL View</Text>
                  </div>
                </Paper>
              )}
              {scenarios.materializeView && (
                <Paper p={0} className="hover-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '20px' }}>
                      <Image
                        src="https://i5.walmartimages.com/seo/Fresh-Red-Delicious-Apple-Each_7320e63a-de46-4a16-9b8c-526e15219a12_3.e557c1ad9973e1f76f512b34950243a3.jpeg?odnHeight=768&odnWidth=768&odnBg=FFFFFF"
                        height={200}
                        fit="contain"
                        alt="Product"
                      />
                      <Text weight={500} align="center" size="sm" mt="md">Fresh Red Delicious Apple</Text>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '20px' }}>
                      <PriceDisplay 
                        price={currentMetric.materialized_view_price}
                        prevPrice={prevPrices.current.materialized_view}
                        reactionTime={currentMetric.materialized_view_end_to_end_latency}
                      />
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid #eee', padding: '15px' }}>
                    <Text weight={500} align="center" color="teal">Cache</Text>
                  </div>
                </Paper>
              )}
              {scenarios.materialize && (
                <Paper p={0} className="hover-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '20px' }}>
                      <Image
                        src="https://i5.walmartimages.com/seo/Fresh-Red-Delicious-Apple-Each_7320e63a-de46-4a16-9b8c-526e15219a12_3.e557c1ad9973e1f76f512b34950243a3.jpeg?odnHeight=768&odnWidth=768&odnBg=FFFFFF"
                        height={200}
                        fit="contain"
                        alt="Product"
                      />
                      <Text weight={500} align="center" size="sm" mt="md">Fresh Red Delicious Apple</Text>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '20px' }}>
                      <PriceDisplay 
                        price={currentMetric.materialize_price}
                        prevPrice={prevPrices.current.materialize}
                        reactionTime={currentMetric.materialize_end_to_end_latency}
                      />
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid #eee', padding: '15px' }}>
                    <Text weight={500} align="center" color="violet">Materialize</Text>
                  </div>
                </Paper>
              )}
            </Group>
          </Paper>

          <Paper p="md" withBorder>
            <Accordion defaultValue={[]} multiple>
              <Accordion.Item value="stats">
                <Accordion.Control>
                  <Text size="lg" weight={500}>Query Statistics</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <LoadingOverlay visible={isPromotionLoading} opacity={0.5} />
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #eee' }}>
                        <th style={{ textAlign: 'left', padding: '8px' }}>Source</th>
                        <th style={{ textAlign: 'right', padding: '8px' }}>Query Latency Max</th>
                        <th style={{ textAlign: 'right', padding: '8px' }}>Query Latency Avg</th>
                        <th style={{ textAlign: 'right', padding: '8px' }}>Query Latency P99</th>
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
                          <td style={{ textAlign: 'right', padding: '8px' }}>{currentMetric.view_qps?.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) || '0.0'}</td>
                        </tr>
                      )}
                      {scenarios.materializeView && (
                        <tr style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px' }}>Cached Table</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeView.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeView.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materializeView.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{currentMetric.materialized_view_qps?.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) || '0.0'}</td>
                        </tr>
                      )}
                      {scenarios.materialize && (
                        <tr style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px' }}>Materialize</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materialize.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materialize.avg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{stats.materialize.p99.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{currentMetric.materialize_qps?.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) || '0.0'}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="latency">
                <Accordion.Control>
                  <Text size="lg" weight={500}>Query Latency</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <div style={{ width: '100%', height: '200px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metrics}>
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
                    </ResponsiveContainer>
                  </div>
                </Accordion.Panel>
              </Accordion.Item>

              {(scenarios.materializeView || scenarios.materialize) && (
                <Accordion.Item value="replication">
                  <Accordion.Control>
                    <Text size="lg" weight={500}>Replication and Refresh Status</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <div style={{ width: '100%', height: '200px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={metrics}>
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
                      </ResponsiveContainer>
                    </div>
                  </Accordion.Panel>
                </Accordion.Item>
              )}

              <Accordion.Item value="reaction">
                <Accordion.Control>
                  <Text size="lg" weight={500}>Reaction Time</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <div style={{ width: '100%', height: '200px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metrics}>
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
                    </ResponsiveContainer>
                  </div>
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="compute">
                <Accordion.Control>
                  <Text size="lg" weight={500}>Compute Usage</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <ContainersCPUChart scenarios={scenarios} />
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Paper>

          <Accordion defaultValue={null} mt="md">
            <Accordion.Item value="advanced">
              <Accordion.Control>Advanced</Accordion.Control>
              <Accordion.Panel>
                <Stack spacing="md">
                  <Stack spacing="xl">
                    <Text size="lg" weight={600} style={{ color: '#1a1a1a' }}>Manual Controls</Text>
                    <Stack spacing="xs">
                      <Text size="sm" weight={500} color="dimmed">Query Source:</Text>
                      <Group position="left" spacing="md">
                        <Button
                          onClick={() => toggleScenario('postgres')}
                          variant={scenarios.postgres ? "filled" : "light"}
                          color="blue"
                          className="button-pulse"
                          style={{ width: '180px' }}
                        >
                          PostgreSQL View
                        </Button>
                        <Button
                          onClick={() => toggleScenario('materializeView')}
                          variant={scenarios.materializeView ? "filled" : "light"}
                          color="teal"
                          className="button-pulse"
                          style={{ width: '180px' }}
                        >
                          Cached Table
                        </Button>
                        <Button
                          onClick={() => toggleScenario('materialize')}
                          variant={scenarios.materialize ? "filled" : "light"}
                          color="violet"
                          className="button-pulse"
                          style={{ width: '180px' }}
                        >
                          Materialize Query
                        </Button>
                      </Group>
                    </Stack>

                    <Stack spacing="xs">
                      <Text size="sm" weight={500} color="dimmed">Traffic Control:</Text>
                      <Group position="left" spacing="md">
                        <Button
                          onClick={() => handleTrafficToggle('postgres')}
                          variant={trafficEnabled.postgres ? "light" : "subtle"}
                          color={trafficEnabled.postgres ? "blue" : "gray"}
                          className="button-pulse"
                          style={{ width: '180px' }}
                        >
                          {trafficEnabled.postgres ? "Stop PostgreSQL" : "Start PostgreSQL"}
                        </Button>
                        <Button
                          onClick={() => handleTrafficToggle('materializeView')}
                          variant={trafficEnabled.materializeView ? "light" : "subtle"}
                          color={trafficEnabled.materializeView ? "teal" : "gray"}
                          className="button-pulse"
                          style={{ width: '180px' }}
                        >
                          {trafficEnabled.materializeView ? "Stop Cache" : "Start Cache"}
                        </Button>
                        <Button
                          onClick={() => handleTrafficToggle('materialize')}
                          variant={trafficEnabled.materialize ? "light" : "subtle"}
                          color={trafficEnabled.materialize ? "violet" : "gray"}
                          className="button-pulse"
                          style={{ width: '180px' }}
                        >
                          {trafficEnabled.materialize ? "Stop Materialize" : "Start Materialize"}
                        </Button>
                      </Group>
                    </Stack>
                  </Stack>

                  <Divider my="md" />

                  <Group>
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
                    <div>Isolation Level: <Badge color="violet" variant="light">{isolationLevel ? isolationLevel.replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown'}</Badge></div>
                  </Group>
                  <Group>
                    <div>Database Size: <Badge color="blue" variant="light">{databaseSize ? `${databaseSize.toFixed(2)} GB` : 'Unknown'}</Badge></div>
                  </Group>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Container>
    </MantineProvider>
  );
}

export default App;
