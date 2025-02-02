import os
import time
import asyncio
from typing import Dict, List, Tuple
import asyncpg
from dotenv import load_dotenv
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import datetime
import subprocess

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

# Global variables
latest_heartbeat = {"insert_time": None, "id": None, "ts": None}
current_isolation_level = "serializable"  # Track the desired isolation level
refresh_interval = 60  # Default refresh interval changed from 30 to 60 seconds
mz_schema = os.getenv('MZ_SCHEMA', 'public')  # Get schema from env with default

# Connection pools
pg_pool = None
mz_pool = None

# Query count tracking with rolling window
WINDOW_SIZE = 1  # 1 second window for QPS calculation to match frontend polling

# Global mappings for consistent key usage
source_to_stats = {
    "PostgreSQL View": "view",
    "PostgreSQL MV": "materialized_view",
    "Materialize": "materialize"
}

stats_mapping = {
    'view': 'view',
    'mv': 'materialized_view',
    'mz': 'materialize'
}

response_mapping = {
    'view': 'view',
    'materialized_view': 'mv',  # This maps to UI's "Cached Table"
    'materialize': 'mz'   # This maps to UI's "Materialize"
}

source_names = {
    'view': 'PostgreSQL View',
    'materialized_view': 'PostgreSQL MV',
    'materialize': 'Materialize'
}

query_stats = {
    "view": {
        "counts": [], 
        "timestamps": [],
        "latencies": [],  # Store last 100 latencies for statistics
        "end_to_end_latencies": [],  # Store last 100 end-to-end latencies
        "current_stats": {
            "qps": 0.0,
            "latency": 0.0,
            "end_to_end_latency": 0.0,
            "price": 0.0,
            "last_updated": 0.0
        }
    },
    "materialized_view": {
        "counts": [], 
        "timestamps": [],
        "latencies": [],
        "end_to_end_latencies": [],  # Store last 100 end-to-end latencies
        "refresh_durations": [],
        "current_stats": {
            "qps": 0.0,
            "latency": 0.0,
            "end_to_end_latency": 0.0,
            "price": 0.0,
            "last_updated": 0.0,
            "freshness": 0.0,
            "refresh_duration": 0.0
        }
    },
    "materialize": {
        "counts": [], 
        "timestamps": [],
        "latencies": [],
        "end_to_end_latencies": [],  # Store last 100 end-to-end latencies
        "current_stats": {
            "qps": 0.0,
            "latency": 0.0,
            "end_to_end_latency": 0.0,
            "price": 0.0,
            "last_updated": 0.0,
            "freshness": 0.0
        }
    }
}

# Lock for pool initialization
pool_init_lock = asyncio.Lock()

# Lock for stats updates
stats_lock = asyncio.Lock()

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Add CPU stats cache
latest_cpu_stats = {
    "timestamp": None,
    "cpu_usage": None
}

def calculate_qps(source: str) -> float:
    stats = query_stats[source]
    current_time = time.time()
    
    # Remove entries older than WINDOW_SIZE seconds
    cutoff_time = current_time - WINDOW_SIZE
    
    # Clean up old entries
    while stats["timestamps"] and stats["timestamps"][0] < cutoff_time:
        stats["counts"].pop(0)
        stats["timestamps"].pop(0)
    
    # Calculate QPS using moving average over the last WINDOW_SIZE seconds
    if not stats["timestamps"]:
        return 0.0
    
    # Get the total queries in the window
    total_queries = sum(stats["counts"])
    
    # Calculate time span - use max of WINDOW_SIZE or actual time span
    if len(stats["timestamps"]) >= 2:
        time_span = max(WINDOW_SIZE, stats["timestamps"][-1] - stats["timestamps"][0])
    else:
        time_span = WINDOW_SIZE
    
    # Calculate QPS
    qps = total_queries / time_span
    
    logger.debug(f"QPS calculation for {source}: {total_queries} queries in {time_span:.2f}s = {qps:.2f} QPS")
    return qps

def calculate_stats(latencies: List[float]) -> Dict:
    """Calculate statistics for a list of latencies or durations.
    All latencies are converted to milliseconds for UI consistency."""
    if not latencies:
        logger.debug("No data points available for stats calculation")
        return {
            "max": 0.0,
            "average": 0.0,
            "p99": 0.0
        }
    
    # Convert all values to milliseconds if they're latencies
    values = []
    for val in latencies:
        # For refresh durations, they're already in seconds and should stay that way
        if "refresh_durations" in str(latencies):
            values.append(val)  # Keep refresh durations in seconds
        else:
            values.append(val * 1000)  # Convert all latencies to ms
    
    stats = {
        "max": max(values),
        "average": sum(values) / len(values),
        "p99": sorted(values)[int(len(values) * 0.99)] if len(values) >= 100 else max(values)
    }
    
    # Log with appropriate unit
    unit = "s" if "refresh_durations" in str(latencies) else "ms"
    logger.debug(
        f"Stats calculation for {len(values)} values ({unit}): "
        f"max={stats['max']:.2f}{unit}, "
        f"avg={stats['average']:.2f}{unit}, "
        f"p99={stats['p99']:.2f}{unit}"
    )
    return stats

# Custom connection class for Materialize that skips PostgreSQL-specific cleanup
class MaterializeConnection(asyncpg.Connection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._closed = False
        self._cleanup_lock = asyncio.Lock()

    def _cleanup(self):
        # Skip cleanup if already closed
        if self._closed:
            return

        try:
            loop = asyncio.get_event_loop()
            
            async def safe_cleanup():
                if self._closed:
                    return
                    
                async with self._cleanup_lock:
                    if not self._closed:
                        try:
                            # Only try to execute ROLLBACK if we have a valid protocol
                            if hasattr(self, '_protocol') and self._protocol is not None:
                                await self.execute("ROLLBACK")
                        except Exception as e:
                            logger.debug(f"Ignoring error during cleanup: {str(e)}")
                        finally:
                            self._closed = True

            if loop.is_running():
                logger.debug("Cleanup: event loop is running, scheduling cleanup")
                loop.create_task(safe_cleanup())
            else:
                logger.debug("Cleanup: event loop not running, running cleanup synchronously")
                loop.run_until_complete(safe_cleanup())
        except Exception as e:
            logger.error(f"Error during Materialize connection cleanup: {str(e)}")
            self._closed = True

    async def close(self, *, timeout: float = None) -> None:
        """Override close to handle cleanup properly"""
        if self._closed:
            return
        
        try:
            async with self._cleanup_lock:
                if not self._closed:
                    try:
                        # Only try to execute ROLLBACK if we have a valid protocol
                        if hasattr(self, '_protocol') and self._protocol is not None:
                            await self.execute("ROLLBACK")
                    except Exception as e:
                        logger.debug(f"Ignoring error during close: {str(e)}")
                    finally:
                        self._closed = True
                        # Call parent close without timeout to avoid additional cleanup
                        await super().close(timeout=None)
        except Exception as e:
            logger.error(f"Error during Materialize connection close: {str(e)}")
            self._closed = True

    async def add_listener(self, channel, callback):
        # Skip listener commands as they're not supported in Materialize
        pass

    async def remove_listener(self, channel, callback):
        # Skip listener commands as they're not supported in Materialize
        pass

    async def reset(self, *, timeout=None):
        # Skip reset for Materialize connections
        pass

async def init_pools():
    """Initialize connection pools with proper limits and error handling"""
    global pg_pool, mz_pool
    
    async with pool_init_lock:
        logger.debug("Starting pool initialization...")
        if pg_pool is None or pg_pool._closing:
            try:
                if pg_pool and pg_pool._closing:
                    try:
                        await asyncio.wait_for(pg_pool.close(), timeout=5.0)
                    except Exception as e:
                        logger.warning(f"Error closing existing PostgreSQL pool: {e}")
                    pg_pool = None
                    
                # Log connection parameters (excluding sensitive info)
                db_host = os.getenv('DB_HOST', 'localhost')
                db_name = os.getenv('DB_NAME', 'postgres')
                db_user = os.getenv('DB_USER', 'postgres')
                logger.debug(f"PostgreSQL connection params: host={db_host}, db={db_name}, user={db_user}")
                
                # First try a quick connection to test connectivity
                logger.debug("Testing initial PostgreSQL connectivity...")
                test_conn = None
                try:
                    test_conn = await asyncio.wait_for(
                        asyncpg.connect(
                            user=db_user,
                            password=os.getenv('DB_PASSWORD', 'postgres'),
                            database=db_name,
                            host=db_host,
                            command_timeout=30.0
                        ),
                        timeout=30.0
                    )
                    await test_conn.execute('SELECT 1')
                    logger.debug("Initial PostgreSQL connectivity test successful")
                finally:
                    if test_conn:
                        await test_conn.close()

                logger.debug("Creating PostgreSQL pool...")
                # Create the pool with a shorter timeout
                pg_pool = await asyncio.wait_for(
                    asyncpg.create_pool(
                        user=db_user,
                        password=os.getenv('DB_PASSWORD', 'postgres'),
                        database=db_name,
                        host=db_host,
                        min_size=2,  # Start with fewer connections
                        max_size=20,
                        command_timeout=120.0,  # Increased from 30.0 to 120.0
                        server_settings={
                            'application_name': 'freshmart_pg',
                            'statement_timeout': '120s',  # Increased from 30s to 120s
                            'idle_in_transaction_session_timeout': '120s'  # Increased from 30s to 120s
                        }
                    ),
                    timeout=120.0  # Increased from 30.0 to 120.0
                )
                logger.debug("PostgreSQL pool object created")
                
                # Test the pool with a quick query
                logger.debug("Testing PostgreSQL pool...")
                async def test_pool():
                    async with pg_pool.acquire() as conn:
                        await conn.execute('SELECT 1')
                await asyncio.wait_for(test_pool(), timeout=5.0)
                logger.debug("PostgreSQL pool test successful")
                
            except asyncio.TimeoutError as e:
                logger.error("Timeout while creating PostgreSQL pool", exc_info=True)
                if pg_pool:
                    try:
                        await asyncio.wait_for(pg_pool.close(), timeout=5.0)
                    except Exception:
                        pass
                    pg_pool = None
                raise Exception(f"PostgreSQL connection timed out: {str(e)}") from e
            except Exception as e:
                logger.error(f"Failed to create PostgreSQL pool: {str(e)}", exc_info=True)
                if pg_pool:
                    try:
                        await asyncio.wait_for(pg_pool.close(), timeout=5.0)
                    except Exception:
                        pass
                    pg_pool = None
                raise Exception(f"PostgreSQL pool creation failed: {str(e)}") from e

        if mz_pool is None or mz_pool._closing:
            try:
                if mz_pool and mz_pool._closing:
                    try:
                        await asyncio.wait_for(mz_pool.close(), timeout=5.0)
                    except Exception as e:
                        logger.warning(f"Error closing existing Materialize pool: {e}")
                    mz_pool = None
                    
                mz_host = os.getenv('MZ_HOST', 'localhost')
                mz_port = int(os.getenv('MZ_PORT', '6875'))
                mz_user = os.getenv('MZ_USER', 'materialize')
                mz_database = os.getenv('MZ_NAME', 'materialize')
                
                logger.debug(f"Materialize connection params: host={mz_host}, port={mz_port}, db={mz_database}, user={mz_user}")
                
                # First try a quick connection to test connectivity
                logger.debug("Testing initial Materialize connectivity...")
                test_conn = None
                try:
                    test_conn = await asyncio.wait_for(
                        asyncpg.connect(
                            user=mz_user,
                            password=os.getenv('MZ_PASSWORD', 'materialize'),
                            database=mz_database,
                            host=mz_host,
                            port=mz_port,
                            command_timeout=5.0,
                            connection_class=MaterializeConnection
                        ),
                        timeout=5.0
                    )
                    await test_conn.execute('SELECT 1')
                    logger.debug("Initial Materialize connectivity test successful")
                finally:
                    if test_conn:
                        await test_conn.close()
                
                logger.debug("Creating Materialize pool...")
                mz_pool = await asyncio.wait_for(
                    asyncpg.create_pool(
                        user=mz_user,
                        password=os.getenv('MZ_PASSWORD', 'materialize'),
                        database=mz_database,
                        host=mz_host,
                        port=mz_port,
                        min_size=2,
                        max_size=20,
                        command_timeout=120.0,  # Increased from 30.0 to 120.0
                        connection_class=MaterializeConnection,
                        server_settings={
                            'application_name': 'freshmart_mz',
                            'statement_timeout': '120s',  # Increased from 30s to 120s
                            'idle_in_transaction_session_timeout': '120s'  # Increased from 30s to 120s
                        }
                    ),
                    timeout=120.0  # Increased from 30.0 to 120.0
                )
                logger.debug("Materialize pool object created")
                
                # Test the pool with a quick query
                logger.debug("Testing Materialize pool...")
                async def test_mz_pool():
                    async with mz_pool.acquire() as conn:
                        await conn.execute('SELECT 1')
                await asyncio.wait_for(test_mz_pool(), timeout=5.0)
                logger.debug("Materialize pool test successful")
                
            except asyncio.TimeoutError as e:
                logger.error("Timeout while creating Materialize pool", exc_info=True)
                if mz_pool:
                    try:
                        await asyncio.wait_for(mz_pool.close(), timeout=5.0)
                    except Exception:
                        pass
                    mz_pool = None
                raise Exception(f"Materialize connection timed out: {str(e)}") from e
            except Exception as e:
                logger.error(f"Failed to create Materialize pool: {str(e)}", exc_info=True)
                if mz_pool:
                    try:
                        await asyncio.wait_for(mz_pool.close(), timeout=5.0)
                    except Exception:
                        pass
                    mz_pool = None
                raise Exception(f"Materialize pool creation failed: {str(e)}") from e
        
        logger.debug("Pool initialization completed")

async def get_connection(pool, is_materialize=False):
    """Get a connection with retries and backoff"""
    global pg_pool, mz_pool
    
    # Initialize pools if needed
    if pool is None:
        await init_pools()
        # After initialization, use the appropriate pool
        pool = mz_pool if is_materialize else pg_pool
        if pool is None:
            raise Exception(f"Failed to initialize {'Materialize' if is_materialize else 'PostgreSQL'} pool")
    
    max_retries = 3
    base_delay = 0.1  # 100ms
    
    for attempt in range(max_retries):
        try:
            return await pool.acquire()
        except asyncpg.exceptions.TooManyConnectionsError:
            if attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)  # Exponential backoff
            logger.warning(f"Connection pool exhausted, retrying in {delay}s...")
            await asyncio.sleep(delay)
        except Exception as e:
            logger.error(f"Error acquiring connection: {e}")
            raise

async def get_postgres_connection():
    """Get a PostgreSQL connection with appropriate timeouts"""
    global pg_pool
    if pg_pool is None:
        await init_pools()
    conn = await pg_pool.acquire()
    await conn.execute("SET statement_timeout TO '120s'")  # Set default timeout to 120 seconds
    return conn

async def get_materialize_connection():
    """Get a connection from the Materialize pool with proper error handling and retries"""
    global mz_pool
    max_retries = 3
    retry_delay = 1.0  # Start with 1 second delay
    
    for attempt in range(max_retries):
        try:
            if mz_pool is None or (mz_pool is not None and mz_pool._closing):
                logger.debug(f"Materialize pool is {mz_pool and 'closing' or 'None'}, reinitializing...")
                if mz_pool is not None and mz_pool._closing:
                    try:
                        await mz_pool.close()
                    except Exception:
                        pass
                    mz_pool = None
                await init_pools()
                
            if mz_pool is None:
                raise Exception("Failed to initialize Materialize pool")
                
            # Use a 5-minute timeout for connection acquisition
            conn = await asyncio.wait_for(mz_pool.acquire(), timeout=300.0)
            
            # Set timeouts and isolation level
            await conn.execute("SET statement_timeout TO '120s'")
            await conn.execute(f"SET TRANSACTION_ISOLATION TO '{current_isolation_level}'")
            
            # Test the connection
            await conn.execute("SELECT 1")
            
            return conn
        except (asyncpg.exceptions.ConnectionDoesNotExistError, 
                asyncio.TimeoutError, 
                asyncpg.exceptions.InterfaceError) as e:
            logger.warning(f"Connection error (attempt {attempt + 1}/{max_retries}): {str(e)}")
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
                # Force pool reinitialization on next attempt
                if mz_pool is not None:
                    try:
                        await mz_pool.close()
                    except Exception:
                        pass
                mz_pool = None
            else:
                raise
        except Exception as e:
            logger.error(f"Error getting Materialize connection: {str(e)}")
            raise

async def release_connection(conn, is_materialize=False):
    """Release a connection back to the appropriate pool with improved error handling"""
    if conn is None:
        return
        
    try:
        if is_materialize:
            if (mz_pool is not None and 
                not getattr(mz_pool, '_closing', True) and 
                hasattr(conn, '_closed') and 
                not conn._closed):
                await asyncio.wait_for(mz_pool.release(conn), timeout=5.0)
        else:
            if pg_pool is not None and not getattr(pg_pool, '_closing', True):
                await asyncio.wait_for(pg_pool.release(conn), timeout=5.0)
    except asyncio.TimeoutError:
        logger.error(f"Timeout releasing {'Materialize' if is_materialize else 'PostgreSQL'} connection")
    except asyncpg.exceptions.ConnectionDoesNotExistError:
        logger.warning(f"{'Materialize' if is_materialize else 'PostgreSQL'} connection already closed")
    except asyncpg.exceptions.InterfaceError as e:
        logger.warning(f"Pool interface error while releasing connection: {str(e)}")
    except Exception as e:
        logger.error(f"Error releasing {'Materialize' if is_materialize else 'PostgreSQL'} connection: {str(e)}")

async def create_heartbeat():
    """Creates heartbeats at a fixed interval"""
    while True:
        try:
            conn = await get_postgres_connection()
            insert_time = time.time()
            
            # Create heartbeat and update product in a transaction
            async with conn.transaction():
                result = await conn.fetchrow("""
                    INSERT INTO heartbeats (ts) VALUES (NOW()) RETURNING id, ts;
                """)
                
                # Update product last_update_time
                await conn.execute("""
                    UPDATE products 
                    SET last_update_time = NOW() 
                    WHERE product_id = 1;
                """)
                
            latest_heartbeat.update({
                "insert_time": insert_time,
                "id": result["id"],
                "ts": result["ts"]
            })
            logger.debug(f"Created heartbeat {result['id']} at {insert_time}")
            await release_connection(conn)
        except Exception as e:
            logger.error(f"Error creating heartbeat: {str(e)}")
        
        # Wait for 1 second between heartbeats
        await asyncio.sleep(1)

async def refresh_materialized_view():
    """Refresh the materialized view with proper lock handling"""
    conn = None
    try:
        logger.debug("Starting materialized view refresh...")
        
        # Get connection with longer command timeout
        conn = await get_postgres_connection()
        await conn.execute("SET statement_timeout TO '120s'")  # 120 seconds
        
        # Set timeouts to 2 minutes
        await conn.execute("""
            SET LOCAL lock_timeout = '120s';
            SET LOCAL statement_timeout = '120s';
            SET LOCAL idle_in_transaction_session_timeout = '120s';
        """)
        
        start_time = time.time()
        
        # Execute refresh with 2-minute timeout
        await conn.execute(
            "REFRESH MATERIALIZED VIEW mv_dynamic_pricing",
            timeout=120.0  # Set command timeout to 120 seconds
        )
        
        # Calculate and log refresh duration
        refresh_duration = time.time() - start_time
        logger.debug(f"Materialized view refresh completed in {refresh_duration:.2f} seconds")
        
        # Update refresh log
        await conn.execute("""
            INSERT INTO materialized_view_refresh_log (view_name, last_refresh, refresh_duration)
            VALUES ('mv_dynamic_pricing', now(), $1)
            ON CONFLICT (view_name) 
            DO UPDATE SET 
                last_refresh = EXCLUDED.last_refresh,
                refresh_duration = EXCLUDED.refresh_duration
        """, refresh_duration)
        
        # Store the refresh duration in our stats
        async with stats_lock:
            logger.debug(f"Storing refresh duration: {refresh_duration:.2f}s")
            stats = query_stats["materialized_view"]
            
            # Initialize refresh_durations if it doesn't exist
            if "refresh_durations" not in stats:
                stats["refresh_durations"] = []
            
            # Append the new duration
            stats["refresh_durations"].append(refresh_duration)
            if len(stats["refresh_durations"]) > 100:
                stats["refresh_durations"].pop(0)
            
            # Update current stats
            stats["current_stats"]["refresh_duration"] = refresh_duration
            
            # Log the current state
            logger.debug(f"Updated refresh durations list (total: {len(stats['refresh_durations'])}): {stats['refresh_durations']}")
        
        return refresh_duration
    except asyncio.exceptions.TimeoutError as e:
        logger.error(f"Materialized view refresh timed out after {time.time() - start_time:.2f} seconds", exc_info=True)
        raise
    except Exception as e:
        logger.error(f"Error refreshing materialized view: {str(e)}", exc_info=True)
        raise
    finally:
        if conn:
            try:
                # Commit any changes and release
                await conn.execute("COMMIT")
                await release_connection(conn)
            except Exception as e:
                logger.error(f"Error releasing connection: {str(e)}")
        logger.debug("Materialized view refresh completed")

async def auto_refresh_materialized_view():
    """Automatically refresh the materialized view with proper coordination"""
    global refresh_interval
    while True:
        try:
            start_time = time.time()
            logger.debug(f"Starting materialized view refresh cycle with interval: {refresh_interval}s")
            
            # Attempt refresh with retries
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    await refresh_materialized_view()
                    break
                except asyncio.TimeoutError:
                    if attempt == max_retries - 1:
                        logger.error("All refresh attempts timed out")
                        break
                    logger.warning(f"Refresh attempt {attempt + 1} timed out, retrying...")
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.error(f"Error in refresh attempt {attempt + 1}: {str(e)}")
                    if attempt == max_retries - 1:
                        break
                    await asyncio.sleep(1)
            
            # Calculate wait time for next refresh using current refresh_interval
            elapsed = time.time() - start_time
            wait_time = max(0, refresh_interval - elapsed)
            logger.debug(f"Refresh completed. Waiting {wait_time:.2f}s until next refresh (interval: {refresh_interval}s)")
            await asyncio.sleep(wait_time)
            
        except Exception as e:
            logger.error(f"Error in auto-refresh cycle: {str(e)}", exc_info=True)
            await asyncio.sleep(1)

async def measure_query_time(query: str, params: Tuple, pool, is_materialize: bool, source: str) -> Tuple[float, any]:
    conn = None
    start_time = time.time()
    try:
        conn = await get_connection(pool, is_materialize)
        timeout = 120.0  # Increased from 30.0 to 120.0
        result = await conn.fetchrow(query, *params, timeout=timeout)
        duration = time.time() - start_time
        
        stats_key = source_to_stats[source]
        if stats_key not in query_stats:
            logger.error(f"Invalid stats key: {stats_key}")
            return duration, result
            
        stats = query_stats[stats_key]
        current_time = time.time()
        
        async with stats_lock:
            stats["counts"].append(1)
            stats["timestamps"].append(current_time)
            # Store latency in seconds for consistency
            stats["latencies"].append(duration)
            
            # Calculate end-to-end latency if we have last_update_time
            if result and "last_update_time" in result:
                # Use current time instead of query_time for end-to-end latency
                current_ts = datetime.datetime.now(datetime.timezone.utc)
                last_update = result["last_update_time"]
                end_to_end_latency = (current_ts - last_update).total_seconds()
                stats["end_to_end_latencies"].append(end_to_end_latency)
                if len(stats["end_to_end_latencies"]) > 100:
                    stats["end_to_end_latencies"].pop(0)
                stats["current_stats"]["end_to_end_latency"] = end_to_end_latency * 1000  # Convert to ms
            
            cutoff_time = current_time - WINDOW_SIZE
            while stats["timestamps"] and stats["timestamps"][0] < cutoff_time:
                if stats["counts"]: stats["counts"].pop(0)
                if stats["timestamps"]: stats["timestamps"].pop(0)
                if stats["latencies"]: stats["latencies"].pop(0)
            
            if len(stats["latencies"]) > 100:
                stats["latencies"].pop(0)
            
            stats["current_stats"]["qps"] = calculate_qps(stats_key)
            # Convert latency to milliseconds for UI
            stats["current_stats"]["latency"] = duration * 1000
            
            # Update price only if we have a valid result with adjusted_price
            if result and "adjusted_price" in result and result["adjusted_price"] is not None:
                try:
                    price = float(result["adjusted_price"])
                    stats["current_stats"]["price"] = price
                    logger.debug(f"Updated price for {source} to {price}")
                except (ValueError, TypeError) as e:
                    logger.error(f"Error converting price for {source}: {str(e)}")
            else:
                logger.debug(f"No valid price update for {source} - result: {result}")
            
            stats["current_stats"]["last_updated"] = current_time
        
        return duration, result
    except asyncio.exceptions.TimeoutError:
        duration = time.time() - start_time
        logger.error(f"{source} query timed out after {duration:.2f} seconds")
        return duration, None
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"{source} query error: {str(e)}", exc_info=True)
        return duration, None
    finally:
        if conn:
            try:
                await asyncio.wait_for(release_connection(conn, is_materialize), timeout=10.0)
            except asyncio.TimeoutError:
                logger.error(f"Timeout releasing connection for {source}")
            except Exception as e:
                logger.error(f"Error releasing connection for {source}: {str(e)}")

async def get_database_size() -> float:
    conn = await get_postgres_connection()
    try:
        logger.debug("Querying database size...")
        # Get the size of the current database in bytes
        size = await conn.fetchval("""
            SELECT pg_database_size(current_database())
        """)
        logger.debug(f"Raw database size in bytes: {size}")
        if size is None:
            logger.error("Database size query returned None")
            return 0.0
        # Convert to GB
        size_gb = size / (1024 * 1024 * 1024)
        logger.debug(f"Converted database size: {size_gb:.2f} GB")
        return size_gb
    except Exception as e:
        logger.error(f"Error getting database size: {str(e)}")
        return 0.0
    finally:
        await release_connection(conn)

async def get_query_metrics(product_id: int) -> Dict:
    """Get query metrics from the current stats"""
    current_time = time.time()
    response = {
        'timestamp': int(current_time * 1000),
        'isolation_level': current_isolation_level
    }
    
    try:
        await init_pools()
        if pg_pool is None:
            logger.error("PostgreSQL pool is not initialized")
            raise Exception("Database connection not available")
            
        pg_conn = None
        mz_conn = None
        
        try:
            # Get PostgreSQL connection
            pg_conn = await get_postgres_connection()
            
            # Get latest freshness values directly from the database
            mv_freshness = await pg_conn.fetchrow("""
                SELECT 
                    EXTRACT(EPOCH FROM (NOW() - last_refresh)) as age,
                    refresh_duration
                FROM materialized_view_refresh_log
                WHERE view_name = 'mv_dynamic_pricing'
            """)
            
            # Get latest replication lag
            pg_heartbeat = await pg_conn.fetchrow("""
                SELECT id, ts, NOW() as current_ts
                FROM heartbeats
                ORDER BY id DESC
                LIMIT 1
            """)
            
            mz_heartbeat = None
            materialize_lag = 0.0
            
            # Try to get Materialize metrics with 5-minute timeout
            if mz_pool is not None:
                try:
                    mz_conn = await get_materialize_connection()
                    logger.debug("Attempting to fetch Materialize heartbeat...")
                    
                    # Use 5-minute timeout for the query
                    mz_heartbeat = await asyncio.wait_for(
                        mz_conn.fetchrow(f'''
                            SELECT id, ts
                            FROM {mz_schema}.heartbeats
                            ORDER BY ts DESC
                            LIMIT 1
                        '''),
                        timeout=300.0  # 5 minute timeout
                    )
                    logger.debug(f"Materialize heartbeat result: {mz_heartbeat}")
                    
                    if pg_heartbeat and mz_heartbeat:
                        pg_id = pg_heartbeat['id']
                        mz_id = mz_heartbeat['id']
                        if pg_id > mz_id:
                            lag = (pg_heartbeat['ts'] - mz_heartbeat['ts']).total_seconds()
                            lag += (pg_heartbeat['current_ts'] - pg_heartbeat['ts']).total_seconds()
                            materialize_lag = max(0.0, lag)
                except asyncio.TimeoutError:
                    logger.warning("Timeout while fetching Materialize metrics (5 minutes)")
                    # Reset Materialize stats on timeout
                    query_stats["materialize"]["current_stats"].update({
                        "qps": None,
                        "latency": None,
                        "end_to_end_latency": None,
                        "price": None,
                        "freshness": None,
                        "last_updated": current_time
                    })
                except asyncpg.exceptions.UndefinedTableError as e:
                    logger.warning(f"Materialize table not found: {str(e)}")
                    query_stats["materialize"]["current_stats"].update({
                        "qps": None,
                        "latency": None,
                        "end_to_end_latency": None,
                        "price": None,
                        "freshness": None,
                        "last_updated": current_time
                    })
                except Exception as e:
                    logger.error(f"Error getting Materialize metrics: {str(e)}", exc_info=True)
                    query_stats["materialize"]["current_stats"].update({
                        "qps": None,
                        "latency": None,
                        "end_to_end_latency": None,
                        "price": None,
                        "freshness": None,
                        "last_updated": current_time
                    })
                finally:
                    if mz_conn:
                        try:
                            await asyncio.wait_for(
                                release_connection(mz_conn, is_materialize=True),
                                timeout=300.0  # 5 minute timeout for release
                            )
                        except asyncio.TimeoutError:
                            logger.warning("Timeout releasing Materialize connection (5 minutes)")
                        except Exception as e:
                            logger.error(f"Error releasing Materialize connection: {str(e)}")
            
            # Read current stats for each source
            for source in ['view', 'materialized_view', 'materialize']:
                stats = query_stats[source]["current_stats"]
                
                # Check if data is fresh (within last 2 seconds)
                is_fresh = current_time - stats["last_updated"] <= 2.0
                
                response.update({
                    f"{source}_latency": stats["latency"] if is_fresh else None,
                    f"{source}_end_to_end_latency": stats["end_to_end_latency"] if is_fresh else None,
                    f"{source}_price": stats["price"] if is_fresh else None,
                    f"{source}_qps": stats["qps"] if is_fresh else None,
                    f"{source}_stats": calculate_stats(query_stats[source]["latencies"]) if is_fresh else None,
                    f"{source}_end_to_end_stats": calculate_stats(query_stats[source]["end_to_end_latencies"]) if is_fresh else None
                })
                
                # Add source-specific stats
                if source == 'materialized_view':
                    # Get refresh durations and ensure they're treated as seconds
                    refresh_durations = query_stats[source]["refresh_durations"]
                    logger.debug(f"Calculating refresh stats from {len(refresh_durations)} durations: {refresh_durations}")
                    
                    # Calculate refresh duration stats
                    if refresh_durations and is_fresh:
                        refresh_stats = {
                            'max': max(refresh_durations),
                            'average': sum(refresh_durations) / len(refresh_durations),
                            'p99': sorted(refresh_durations)[int(len(refresh_durations) * 0.99)] if len(refresh_durations) >= 100 else max(refresh_durations)
                        }
                    else:
                        refresh_stats = None
                    
                    response.update({
                        'materialized_view_freshness': float(mv_freshness['age']) if mv_freshness and is_fresh else None,
                        'materialized_view_refresh_duration': float(mv_freshness['refresh_duration']) if mv_freshness and is_fresh else None,
                        'materialized_view_refresh_stats': refresh_stats
                    })
                    
                    logger.debug(f"MV Stats:"
                              f"\n  - Current Age: {float(mv_freshness['age']) if mv_freshness else 0.0:.2f}s"
                              f"\n  - Current Refresh Duration: {float(mv_freshness['refresh_duration']) if mv_freshness else 0.0:.2f}s"
                              f"\n  - Refresh Stats: {refresh_stats}")
                elif source == 'materialize':
                    response.update({
                        'materialize_freshness': materialize_lag if is_fresh else None
                    })
                    logger.debug(f"Materialize Stats:"
                              f"\n  - Current Replication Lag: {materialize_lag:.2f}s")
            
        finally:
            # Release connections
            if pg_conn:
                await release_connection(pg_conn)
            if mz_conn:
                await release_connection(mz_conn, is_materialize=True)
        
    except Exception as e:
        logger.error(f"Error in get_query_metrics: {str(e)}", exc_info=True)
        raise
    
    return response

async def toggle_promotion(product_id: int):
    conn = await get_postgres_connection()
    try:
        # Just do the update and return immediately
        result = await conn.fetchrow("""
            UPDATE promotions
            SET active = NOT active,
                updated_at = NOW()
            WHERE product_id = $1
            RETURNING updated_at, active
        """, product_id)
        
        return {
            "status": "success",
            "updated_at": result["updated_at"] if result else None,
            "active": result["active"] if result else None
        }
    finally:
        await release_connection(conn)

async def toggle_view_index() -> Dict:
    try:
        conn = await get_materialize_connection()
        try:
            # Check if index exists
            if await check_materialize_index_exists():
                await conn.execute(f"DROP INDEX {mz_schema}.dynamic_pricing_product_id_idx")
                return {"message": "Index dropped successfully", "index_exists": False}
            else:
                await conn.execute(f"CREATE INDEX dynamic_pricing_product_id_idx ON {mz_schema}.dynamic_pricing (product_id)")
                return {"message": "Index created successfully", "index_exists": True}
        except Exception as e:
            print(f"Error toggling index: {str(e)}")
            raise Exception(f"Failed to toggle index: {str(e)}")
    except Exception as e:
        print(f"Outer error in toggle_view_index: {str(e)}")
        raise
    finally:
        await release_connection(conn, is_materialize=True)

async def get_view_index_status() -> bool:
    conn = await get_materialize_connection()
    try:
        index_exists = await conn.fetchval("""
            SELECT TRUE 
            FROM mz_catalog.mz_indexes
            WHERE name = 'dynamic_pricing_product_id_idx'
        """)
        return index_exists or False
    finally:
        await release_connection(conn, is_materialize=True)

async def get_isolation_level() -> str:
    conn = await get_materialize_connection()
    try:
        level = await conn.fetchval("SHOW transaction_isolation")
        return level.lower()  # Return lowercase for consistent comparison
    finally:
        await release_connection(conn, is_materialize=True)

async def toggle_isolation_level() -> Dict:
    global current_isolation_level
    conn = await get_materialize_connection()
    try:
        # Toggle between serializable and strict serializable
        new_level = "strict serializable" if current_isolation_level == "serializable" else "serializable"
        await conn.execute(f"SET TRANSACTION_ISOLATION TO '{new_level}'")
        current_isolation_level = new_level  # Update the global variable
        
        return {
            "status": "success",
            "isolation_level": new_level
        }
    finally:
        await release_connection(conn, is_materialize=True)

# Add a route to get the current refresh interval
@app.get("/current-refresh-interval")
async def get_current_refresh_interval():
    """Get the current refresh interval for the materialized view"""
    return {
        "status": "success",
        "refresh_interval": refresh_interval
    }

# Add a route to configure the refresh interval
@app.post("/configure-refresh-interval/{interval}")
async def configure_refresh_interval(interval: int):
    """Configure the refresh interval for the materialized view"""
    global refresh_interval
    
    # Input validation
    if interval < 1:
        logger.error(f"Invalid refresh interval requested: {interval}s (must be >= 1)")
        raise HTTPException(status_code=400, detail="Interval must be at least 1 second")
    
    # Update the interval
    old_interval = refresh_interval
    refresh_interval = interval
    
    logger.info(f"Updated materialized view refresh interval from {old_interval}s to {interval}s")
    return {
        "status": "success",
        "old_interval": old_interval,
        "new_interval": interval,
        "message": f"Refresh interval updated from {old_interval}s to {interval}s"
    }

async def check_materialize_index_exists():
    """Check if the Materialize index exists with proper error handling and retries"""
    global mz_pool
    max_retries = 3
    retry_delay = 1.0  # Start with 1 second delay
    
    for attempt in range(max_retries):
        conn = None
        try:
            # Initialize pools if needed
            if mz_pool is None:
                await init_pools()
                if mz_pool is None:
                    logger.warning("Failed to initialize Materialize pool")
                    return False
            
            # Check if pool is closing and reinitialize if needed
            if getattr(mz_pool, '_closing', False):
                logger.debug("Materialize pool is closing, reinitializing...")
                try:
                    await mz_pool.close()
                except Exception:
                    pass
                mz_pool = None
                await init_pools()
                if mz_pool is None:
                    logger.warning("Failed to reinitialize Materialize pool")
                    return False
            
            conn = await get_materialize_connection()
            result = await conn.fetchval("""
                SELECT TRUE 
                FROM mz_catalog.mz_indexes
                WHERE name = 'dynamic_pricing_product_id_idx'
            """)
            return result or False
        except asyncpg.exceptions.ConnectionDoesNotExistError:
            logger.warning(f"Connection lost during index check (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                await asyncio.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
            continue
        except Exception as e:
            logger.error(f"Error checking Materialize index: {str(e)}")
            return False
        finally:
            if conn:
                try:
                    await release_connection(conn, is_materialize=True)
                except Exception as e:
                    logger.error(f"Error releasing connection during index check: {str(e)}")

async def continuous_query_load():
    """Continuously send queries to all sources with balanced concurrency"""
    product_id = 1
    
    # Track active tasks per source using consistent keys
    active_tasks = {
        'view': set(),
        'materialized_view': set(),
        'materialize': set()
    }
    
    # Define queries with explicit column selection
    QUERIES = {
        'view': f"""
            SELECT product_id, adjusted_price, last_update_time
            FROM dynamic_pricing 
            WHERE product_id = $1
        """,
        'materialized_view': f"""
            SELECT product_id, adjusted_price, last_update_time
            FROM mv_dynamic_pricing 
            WHERE product_id = $1
        """,
        'materialize': f"""
            SELECT product_id, adjusted_price, last_update_time
            FROM {mz_schema}.dynamic_pricing 
            WHERE product_id = $1
        """
    }
    
    async def execute_query(source_key: str, is_materialize: bool, pool, query: str):
        """Execute a single query with proper delays"""
        try:
            # Map source key to display name using source_names mapping
            source_display = source_names[source_key]
            
            # Add delay before query to reduce contention
            await asyncio.sleep(0.5)  # Increased delay between queries
            
            # Create and track the query task
            task = asyncio.create_task(measure_query_time(
                query,
                [product_id],
                pool,
                is_materialize,
                source_display
            ))
            
            # Track the task in active_tasks
            active_tasks[source_key].add(task)
            try:
                await task
            finally:
                active_tasks[source_key].remove(task)
            
            # Get current concurrency limits
            max_concurrent = await get_concurrency_limits()
            
            # Only start a new query if under limit and after a delay
            if len(active_tasks[source_key]) < max_concurrent[source_key]:
                await asyncio.sleep(0.2)  # Added delay before starting new query
                asyncio.create_task(execute_query(source_key, is_materialize, pool, query))
                
        except Exception as e:
            logger.error(f"Error executing query for {source_key}: {str(e)}", exc_info=True)
    
    async def get_concurrency_limits():
        """Get concurrency limits based on index status"""
        has_index = await check_materialize_index_exists()
        return {
            'view': 1,     # PostgreSQL View - low concurrency
            'materialized_view': 1,  # Materialized View - low concurrency
            'materialize': 2 if has_index else 1  # Materialize - moderate concurrency with index
        }
    
    while True:
        try:
            # Get current concurrency limits
            max_concurrent = await get_concurrency_limits()
            
            # Start initial queries if under limit with delays between each type
            if len(active_tasks['view']) < max_concurrent['view']:
                asyncio.create_task(execute_query(
                    'view',
                    False,
                    pg_pool,
                    QUERIES['view']
                ))
                await asyncio.sleep(0.2)  # Added delay between different query types
            
            if len(active_tasks['materialized_view']) < max_concurrent['materialized_view']:
                asyncio.create_task(execute_query(
                    'materialized_view',
                    False,
                    pg_pool,
                    QUERIES['materialized_view']
                ))
                await asyncio.sleep(0.2)  # Added delay between different query types
            
            if mz_pool is not None and len(active_tasks['materialize']) < max_concurrent['materialize']:
                asyncio.create_task(execute_query(
                    'materialize',
                    True,
                    mz_pool,
                    QUERIES['materialize']
                ))
            
            # Increased pause between checks
            await asyncio.sleep(0.5)
            
        except Exception as e:
            logger.error(f"Error in continuous query load: {str(e)}", exc_info=True)
            await asyncio.sleep(1)

async def update_freshness_metrics():
    """Background task to update freshness metrics for materialized views and Materialize"""
    while True:
        try:
            await init_pools()
            if pg_pool is None:
                logger.error("PostgreSQL pool not initialized")
                await asyncio.sleep(1)
                continue

            # Log current freshness values
            logger.info(f"Current Freshness Values:"
                       f"\n  - Materialized View: {query_stats['materialized_view']['current_stats']['freshness']:.2f}s"
                       f"\n  - Materialize: {query_stats['materialize']['current_stats']['freshness']:.2f}s")
            
            # Update MV freshness
            try:
                mv_stats = await pg_pool.fetchrow(f"""
                    SELECT 
                        last_refresh,
                        refresh_duration,
                        EXTRACT(EPOCH FROM (NOW() - last_refresh)) as age,
                        NOW() as current_ts
                    FROM materialized_view_refresh_log
                    WHERE view_name = 'mv_dynamic_pricing'
                """)
                
                if mv_stats:
                    async with stats_lock:
                        stats = query_stats["materialized_view"]
                        duration = float(mv_stats['refresh_duration'])
                        age = float(mv_stats['age'])
                        
                        stats["refresh_durations"].append(duration)
                        if len(stats["refresh_durations"]) > 100:
                            stats["refresh_durations"].pop(0)
                        
                        stats["current_stats"]["freshness"] = age
                        stats["current_stats"]["refresh_duration"] = duration
                        stats["current_stats"]["last_updated"] = time.time()
                        
                        logger.debug(f"Updated MV Freshness: {age:.2f}s (Refresh Duration: {duration:.2f}s)")
            except Exception as e:
                logger.error(f"Error updating MV freshness: {str(e)}")
            
            # Update Materialize freshness
            if mz_pool is not None:
                try:
                    pg_heartbeat = await pg_pool.fetchrow(f"""
                        SELECT id, ts
                        FROM {mz_schema}.heartbeats
                        ORDER BY ts DESC
                        LIMIT 1
                    """)
                    
                    mz_heartbeat = await mz_pool.fetchrow(f"""
                        SELECT id, ts
                        FROM {mz_schema}.heartbeats
                        ORDER BY ts DESC
                        LIMIT 1
                    """)
                    
                    if pg_heartbeat and mz_heartbeat:
                        pg_id = pg_heartbeat['id']
                        mz_id = mz_heartbeat['id']
                        pg_ts = pg_heartbeat['ts']
                        mz_ts = mz_heartbeat['ts']
                        current_ts = pg_heartbeat['current_ts']
                        
                        async with stats_lock:
                            stats = query_stats["materialize"]["current_stats"]
                            if pg_id > mz_id:
                                freshness = (pg_ts - mz_ts).total_seconds()
                                freshness += (current_ts - pg_ts).total_seconds()
                                stats["freshness"] = max(0.0, freshness)
                            else:
                                stats["freshness"] = 0.0
                            stats["last_updated"] = time.time()
                        
                        logger.debug(f"Updated Materialize Freshness: {stats['freshness']:.2f}s (PG ID: {pg_id}, MZ ID: {mz_id})")
                except Exception as e:
                    logger.error(f"Error updating Materialize freshness: {str(e)}")
            
            await asyncio.sleep(1)
            
        except Exception as e:
            logger.error(f"Error in update_freshness_metrics: {str(e)}")
            await asyncio.sleep(1)

async def collect_cpu_stats():
    """Background task to collect CPU stats every second"""
    global latest_cpu_stats
    while True:
        try:
            # Get stats from docker container
            result = subprocess.run(
                ['docker', 'stats', 'my_postgres', '--no-stream', '--format', '{{.CPUPerc}}'],
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                logger.error(f"Error getting Docker stats: {result.stderr}")
            else:
                # Parse the CPU percentage
                cpu_str = result.stdout.strip().rstrip('%')
                if cpu_str:
                    try:
                        cpu_usage = float(cpu_str)
                        latest_cpu_stats.update({
                            "timestamp": int(time.time() * 1000),
                            "cpu_usage": cpu_usage
                        })
                    except ValueError as e:
                        logger.error(f"Error converting CPU string '{cpu_str}' to float: {str(e)}")
                else:
                    logger.error("Empty CPU percentage string")
        except Exception as e:
            logger.error(f"Error collecting CPU stats: {str(e)}")
        
        # Wait before next collection
        await asyncio.sleep(1)

async def get_postgres_cpu_stats():
    """Get CPU usage stats from cache"""
    return latest_cpu_stats

# Update startup event to start the freshness metrics update task
@app.on_event("startup")
async def startup_event():
    """Initialize the application state"""
    global refresh_interval, pg_pool, mz_pool
    logger.info("=== Starting Application Initialization ===")
    refresh_interval = 60  # Default to 60 seconds
    
    # Initialize pools first
    try:
        logger.info("Step 1: Initializing database pools...")
        logger.info("1.1: About to call init_pools()")
        await init_pools()
        if pg_pool:
            logger.info("1.2: PostgreSQL pool initialized successfully")
        if mz_pool:
            logger.info("1.3: Materialize pool initialized successfully")
        logger.info("Step 1: Database pools initialization completed")
    except Exception as e:
        logger.error(f"Failed to initialize pools: {str(e)}", exc_info=True)
        # Continue even if Materialize pool fails
        if pg_pool is None:
            logger.error("PostgreSQL pool initialization failed - application cannot start")
            raise
    
    # Force initial materialized view refresh
    logger.info("Step 2: Performing initial materialized view refresh...")
    try:
        await refresh_materialized_view()
        logger.info("Step 2: Initial materialized view refresh completed")
    except Exception as e:
        logger.error(f"Failed to perform initial materialized view refresh: {str(e)}", exc_info=True)
        # Continue even if initial refresh fails
    
    # Start background tasks
    logger.info("Step 3: Starting background tasks...")
    background_tasks = []
    
    try:
        logger.info("3.1: Starting heartbeat task")
        heartbeat_task = asyncio.create_task(create_heartbeat(), name="heartbeat")
        background_tasks.append(heartbeat_task)
        logger.info("3.2: Heartbeat task created")
        
        logger.info("3.3: Starting materialized view refresh task")
        mv_refresh_task = asyncio.create_task(auto_refresh_materialized_view(), name="mv_refresh")
        background_tasks.append(mv_refresh_task)
        logger.info("3.4: Materialized view refresh task created")
        
        logger.info("3.5: Starting continuous query load task")
        query_load_task = asyncio.create_task(continuous_query_load(), name="query_load")
        background_tasks.append(query_load_task)
        logger.info("3.6: Continuous query load task created")
        
        logger.info("3.7: Starting freshness metrics task")
        freshness_task = asyncio.create_task(update_freshness_metrics(), name="freshness_metrics")
        background_tasks.append(freshness_task)
        logger.info("3.8: Freshness metrics task created")

        logger.info("3.9: Starting CPU stats collection task")
        cpu_stats_task = asyncio.create_task(collect_cpu_stats(), name="cpu_stats")
        background_tasks.append(cpu_stats_task)
        logger.info("3.10: CPU stats collection task created")
    except Exception as e:
        logger.error(f"Error creating background tasks: {str(e)}", exc_info=True)
        raise
    
    # Wait a short time to ensure tasks have started
    logger.info("Step 4: Waiting for tasks to initialize...")
    try:
        await asyncio.sleep(1)
        logger.info("Step 4: Initial wait completed")
    except Exception as e:
        logger.error(f"Error during initialization wait: {str(e)}", exc_info=True)
        raise
    
    # Check if tasks are running
    logger.info("Step 5: Checking task status...")
    try:
        for task in background_tasks:
            task_name = task.get_name()
            logger.info(f"5.1: Checking status of {task_name}")
            
            if task.done():
                try:
                    exc = task.exception()
                    logger.error(f"5.2: Task {task_name} failed during startup: {exc}")
                    raise exc
                except asyncio.InvalidStateError:
                    logger.warning(f"5.3: Task {task_name} completed unexpectedly during startup")
            else:
                logger.info(f"5.4: Task {task_name} is running")
    except Exception as e:
        logger.error(f"Error checking task status: {str(e)}", exc_info=True)
        raise
    
    logger.info("=== Application Startup Completed Successfully ===")
