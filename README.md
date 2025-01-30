# Freshmart Dynamic Pricing Demo

This project demonstrates different approaches to implementing dynamic pricing in an e-commerce setting, comparing PostgreSQL views, PostgreSQL materialized views (cached tables), and Materialize for real-time price updates. It provides real-time visualization of query performance, data freshness, and price consistency.

## Features

- Real-time price comparison across three implementations:
  - PostgreSQL View (direct query)
  - PostgreSQL Materialized View (cached table)
  - Materialize (incremental view maintenance)

- Performance monitoring:
  - Query latency tracking for all implementations
  - Query throughput (QPS) measurements
  - End-to-end reaction time analysis
  - Database size monitoring

- Data freshness tracking:
  - Materialized view refresh age
  - Materialize replication lag
  - Configurable refresh intervals
  - Cache rehydration time statistics

- Interactive controls:
  - Toggle promotional pricing
  - Switch isolation levels (Serializable/Strict Serializable)
  - Configure refresh intervals (30s to 2m)
  - Enable/disable different scenarios
  - Toggle reaction time visibility

- Visual analytics:
  - Real-time price updates with visual feedback
  - Query latency charts
  - Replication and refresh status charts
  - Comprehensive statistics table

## Technical Implementation

### Query Performance Tracking

The system tracks several performance metrics:
- Query latency (time to execute the query)
- End-to-end latency (total time including data propagation)
- Queries per second (QPS)
- Statistical aggregates (max, average, p99)

### Data Freshness Monitoring

1. Materialized View Refresh:
   - Configurable refresh interval (30s to 2m)
   - Tracks refresh duration and success
   - Monitors refresh age (time since last refresh)

2. Materialize Replication:
   - Measures replication lag via heartbeats
   - Color-coded status indicators:
     - Green: < 1 second lag
     - Yellow: 1-5 seconds lag
     - Red: > 5 seconds lag

### Database Connections

The application maintains separate connection pools for:
- PostgreSQL: For direct view queries and materialized view operations
- Materialize: For real-time materialized view queries

### Error Handling

- Graceful degradation on connection issues
- Automatic retry mechanisms
- Visual error feedback in the UI
- Timeout handling for long-running operations

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py         # FastAPI application
│   │   └── database.py     # Database operations and metrics
│   └── requirements.txt    # Python dependencies
└── frontend/
    ├── src/
    │   ├── App.jsx         # Main React application
    │   └── components/     # React components
    └── package.json        # Node.js dependencies
```

## Setup

### Prerequisites

1. PostgreSQL database with:
   - Dynamic pricing views and tables
   - Materialized view support
   - Appropriate indices for performance

2. Materialize instance with:
   - Connection to PostgreSQL configured
   - Required materialized views created

### Environment Configuration

Create a `.env` file in the backend directory:
```
# PostgreSQL configuration
DB_HOST=localhost
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=postgres

# Materialize configuration
MZ_HOST=localhost
MZ_PORT=6875
MZ_USER=materialize
MZ_PASSWORD=materialize
MZ_NAME=materialize
```

### Backend Setup

1. Install Python dependencies:
```bash
cd backend
pip install -r requirements.txt
```

2. Start the FastAPI server:
```bash
uvicorn app.main:app --reload
```

### Frontend Setup

1. Install Node.js dependencies:
```bash
cd frontend
npm install
```

2. Start the development server:
```bash
npm run dev
```

## Usage Guide

1. Access the application (default: http://localhost:5173)
2. Use the control panel to:
   - Toggle promotional pricing
   - Switch isolation levels
   - Adjust refresh intervals
   - Enable/disable different pricing scenarios

3. Monitor the real-time displays:
   - Price comparisons across implementations
   - Query performance metrics
   - Data freshness indicators
   - System statistics

4. Analyze performance through:
   - Query latency charts
   - Replication lag indicators
   - Statistical summaries
   - Reaction time analysis

## Performance Characteristics

The demo illustrates the trade-offs between different implementation approaches:

1. PostgreSQL View:
   - Always fresh data
   - Higher latency
   - Direct query overhead
   - Consistent isolation level

2. PostgreSQL Materialized View (Cached Table):
   - Low query latency
   - Periodic refresh overhead
   - Configurable freshness
   - Predictable performance

3. Materialize:
   - Real-time updates
   - Low query latency
   - Incremental maintenance
   - Replication lag monitoring

These characteristics help in understanding the best approach for different use cases in dynamic pricing scenarios.