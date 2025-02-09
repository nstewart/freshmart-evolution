import os
import time
import asyncio
from typing import Dict, List, Tuple
import asyncpg
from dotenv import load_dotenv
import logging
import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

# Global variables and settings
latest_heartbeat = {"insert_time": None, "id": None, "ts": None}
current_isolation_level = "serializable"  # Track the desired isolation level
refresh_interval = 60  # Default refresh interval in seconds
mz_schema = os.getenv('MZ_SCHEMA', 'public')  # Materialize schema (default: public)

# Global pools (initialized once)
postgres_pool = None
materialize_pool = None

# Track active tasks per source (if needed for concurrency control)
active_tasks = {
    'view': set(),
    'materialized_view': set(),
    'materialize': set()
}

# Rolling window for QPS calculation
WINDOW_SIZE = 1  # 1 second window

# Mappings for stats keys and source names
source_to_stats = {
    "PostgreSQL View": "view",
    "PostgreSQL MV": "materialized_view",
    "Materialize": "materialize"
}

response_mapping = {
    'view': 'view',
    'materialized_view': 'mv',  # Maps to UI's "Cached Table"
    'materialize': 'mz'  # Maps to UI's "Materialize"
}

source_names = {
    'view': 'PostgreSQL View',
    'materialized_view': 'PostgreSQL MV',
    'materialize': 'Materialize'
}

# Query statistics storage
query_stats = {
    "view": {
        "counts": [],
        "timestamps": [],
        "latencies": [],
        "end_to_end_latencies": [],
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
        "end_to_end_latencies": [],
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
        "end_to_end_latencies": [],
        "current_stats": {
            "qps": 0.0,
            "latency": 0.0,
            "end_to_end_latency": 0.0,
            "price": 0.0,
            "last_updated": 0.0,
            "freshness": 0.0
        }
    },
    "cpu": {
        "measurements": [],
        "timestamps": [],
        "current_stats": {
            "usage": 0.0,
            "last_updated": 0.0
        }
    }
}

# Lock for updating stats
stats_lock = asyncio.Lock()

# Traffic control (if you want to toggle query load)
traffic_enabled = {
    "view": True,
    "materialized_view": True,
    "materialize": True
}


def calculate_qps(source: str) -> float:
    stats = query_stats[source]
    current_time = time.time()
    cutoff_time = current_time - WINDOW_SIZE
    while stats["timestamps"] and stats["timestamps"][0] < cutoff_time:
        stats["counts"].pop(0)
        stats["timestamps"].pop(0)
    if not stats["timestamps"]:
        return 0.0
    total_queries = sum(stats["counts"])
    if len(stats["timestamps"]) >= 2:
        time_span = max(WINDOW_SIZE, stats["timestamps"][-1] - stats["timestamps"][0])
    else:
        time_span = WINDOW_SIZE
    qps = total_queries / time_span
    logger.debug(f"QPS calculation for {source}: {total_queries} queries in {time_span:.2f}s = {qps:.2f} QPS")
    return qps


def calculate_stats(latencies: List[float]) -> Dict:
    """Calculate statistics (max, average, p99) from a list of latencies.
       Latencies are converted to milliseconds unless they are refresh durations."""
    if not latencies:
        return {"max": 0.0, "average": 0.0, "p99": 0.0}
    values = []
    for val in latencies:
        # Leave refresh durations in seconds; convert others to ms.
        if "refresh_durations" in str(latencies):
            values.append(val)
        else:
            values.append(val * 1000)
    stats = {
        "max": max(values),
        "average": sum(values) / len(values),
        "p99": sorted(values)[int(len(values) * 0.99)] if len(values) >= 100 else max(values)
    }
    unit = "s" if "refresh_durations" in str(latencies) else "ms"
    logger.debug(
        f"Stats calculation for {len(values)} values ({unit}): max={stats['max']:.2f}{unit}, "
        f"avg={stats['average']:.2f}{unit}, p99={stats['p99']:.2f}{unit}"
    )
    return stats


# ============================================================================
# Pool initialization and connection context managers
# ============================================================================

async def new_postgres_pool():
    return await asyncpg.create_pool(
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'postgres'),
        database=os.getenv('DB_NAME', 'postgres'),
        host=os.getenv('DB_HOST', 'localhost'),
        command_timeout=120.0,
        min_size=2,
        max_size=20,
        server_settings={
            'application_name': 'freshmart_pg',
            'statement_timeout': '120s',
            'idle_in_transaction_session_timeout': '120s'
        }
    )


async def new_materialize_pool():
    logger.info("Initializing Materialize pool...")
    return await asyncpg.create_pool(
        user=os.getenv('MZ_USER', 'materialize'),
        password=os.getenv('MZ_PASSWORD', 'materialize'),
        database=os.getenv('MZ_NAME', 'materialize'),
        host=os.getenv('MZ_HOST', 'localhost'),
        port=int(os.getenv('MZ_PORT', '6875')),
        command_timeout=120.0,
        connection_class=MaterializeConnection,
        min_size=2,
        max_size=20,
        server_settings={
            'application_name': 'freshmart_mz',
            'statement_timeout': '120s',
            'idle_in_transaction_session_timeout': '120s',
            'statement_logging_sample_rate': '0'
        }
    )


async def init_pools():
    """Initialize the global connection pools for PostgreSQL and Materialize."""
    global postgres_pool, materialize_pool
    postgres_pool = await new_postgres_pool()
    materialize_pool = await new_materialize_pool()


# ============================================================================
# Functions using connection pools
# ============================================================================

async def create_heartbeat():
    """Create heartbeat entries at a fixed interval."""
    while True:
        try:
            async with postgres_pool.acquire() as conn:
                insert_time = time.time()
                async with conn.transaction():
                    result = await conn.fetchrow(
                        "INSERT INTO heartbeats (ts) VALUES (NOW()) RETURNING id, ts;"
                    )
                    await conn.execute(
                        "UPDATE products SET last_update_time = NOW() WHERE product_id = 1;"
                    )
                latest_heartbeat.update({
                    "insert_time": insert_time,
                    "id": result["id"],
                    "ts": result["ts"]
                })
                logger.debug(f"Created heartbeat {result['id']} at {insert_time}")
        except Exception as e:
            logger.error(f"Error creating heartbeat: {str(e)}")
        await asyncio.sleep(1)


async def refresh_materialized_view():
    """Refresh the materialized view with proper lock handling."""
    start_time = time.time()
    try:
        async with postgres_pool.acquire() as conn:
            await conn.execute("SET statement_timeout TO '120s'")
            await conn.execute("""
                SET LOCAL lock_timeout = '120s';
                SET LOCAL statement_timeout = '120s';
                SET LOCAL idle_in_transaction_session_timeout = '120s';
            """)
            await conn.execute("REFRESH MATERIALIZED VIEW mv_dynamic_pricing", timeout=120.0)
            refresh_duration = time.time() - start_time
            logger.debug(f"Materialized view refresh completed in {refresh_duration:.2f} seconds")
            await conn.execute("""
                INSERT INTO materialized_view_refresh_log (view_name, last_refresh, refresh_duration)
                VALUES ('mv_dynamic_pricing', NOW(), $1)
                ON CONFLICT (view_name)
                DO UPDATE SET last_refresh = EXCLUDED.last_refresh, refresh_duration = EXCLUDED.refresh_duration
            """, refresh_duration)
            async with stats_lock:
                stats = query_stats["materialized_view"]
                stats.setdefault("refresh_durations", []).append(refresh_duration)
                if len(stats["refresh_durations"]) > 100:
                    stats["refresh_durations"].pop(0)
                stats["current_stats"]["refresh_duration"] = refresh_duration
            return refresh_duration
    except asyncio.exceptions.TimeoutError as e:
        logger.error(f"Materialized view refresh timed out after {time.time() - start_time:.2f} seconds", exc_info=True)
        raise
    except Exception as e:
        logger.error(f"Error refreshing materialized view: {str(e)}", exc_info=True)
        raise


async def auto_refresh_materialized_view():
    """Automatically refresh the materialized view using a fixed interval."""
    global refresh_interval
    while True:
        try:
            if not traffic_enabled["materialized_view"]:
                logger.debug("Materialized view traffic disabled, skipping refresh")
                await asyncio.sleep(1)
                continue

            start_time = time.time()
            logger.debug(f"Starting MV refresh cycle (interval: {refresh_interval}s)")
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
            elapsed = time.time() - start_time
            wait_time = max(0, refresh_interval - elapsed)
            logger.debug(f"Refresh cycle complete. Waiting {wait_time:.2f}s until next cycle.")
            await asyncio.sleep(wait_time)
        except Exception as e:
            logger.error(f"Error in auto-refresh cycle: {str(e)}", exc_info=True)
            await asyncio.sleep(1)

async def add_to_cart():
    """Automatically adds a new item to a shopping cart at a fixed internal"""
    async def insert_item():
        try:
            async with postgres_pool.acquire() as conn:
                # First, check if product_id 1 exists in the cart
                has_product_one = await conn.fetchval("""
                    SELECT EXISTS(
                        SELECT 1 FROM shopping_cart WHERE product_id = 1
                    )
                """)

                # If product_id 1 doesn't exist, insert it first
                if not has_product_one:
                    await conn.execute("""
                        INSERT INTO shopping_cart (product_id, product_name, category_id, price)
                        SELECT product_id, product_name, category_id, base_price 
                        FROM products
                        WHERE product_id = 1;
                    """)

                # Then insert a random product
                await conn.execute("""
                    INSERT INTO shopping_cart (product_id, product_name, category_id, price)
                    SELECT product_id, product_name, category_id, base_price FROM products
                    WHERE product_id != 1
                    ORDER BY RANDOM()
                    LIMIT 1;
                """)
        except Exception as e:
            logger.error(f"Error adding item to shopping cart: {str(e)}", exc_info=True)
            raise

    async def delete_item():
        try:
            async with postgres_pool.acquire() as conn:
                await conn.execute("""
                    DELETE FROM shopping_cart
                    WHERE ts IN (
                        SELECT ts 
                        FROM shopping_cart 
                        WHERE product_id != 1
                        ORDER BY RANDOM() 
                        LIMIT 1
                    )
                """)
        except Exception as e:
            logger.error(f"Error removing item from shopping cart: {str(e)}", exc_info=True)
            raise

    # Initialize cart with 10 random items (product 1 will be included)
    for _ in range(10):
        await insert_item()

    while True:
        await insert_item()
        await delete_item()
        await asyncio.sleep(30.0)  # Sleep for 30 seconds

async def measure_query_time(query: str, params: Tuple, is_materialize: bool, source: str) -> Tuple[float, any]:
    start_time = time.time()
    try:
        if is_materialize:
            async with materialize_pool.acquire() as conn:
                result = await conn.fetchrow(query, *params, timeout=120.0)
        else:
            async with postgres_pool.acquire() as conn:
                result = await conn.fetchrow(query, *params, timeout=120.0)
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
            stats["latencies"].append(duration)
            if result and "last_update_time" in result:
                current_ts = datetime.datetime.now(datetime.timezone.utc)
                last_update = result["last_update_time"]
                end_to_end_latency = (current_ts - last_update).total_seconds()
                stats["end_to_end_latencies"].append(end_to_end_latency)
                if len(stats["end_to_end_latencies"]) > 100:
                    stats["end_to_end_latencies"].pop(0)
                stats["current_stats"]["end_to_end_latency"] = end_to_end_latency * 1000
            cutoff_time = current_time - WINDOW_SIZE
            while stats["timestamps"] and stats["timestamps"][0] < cutoff_time:
                if stats["counts"]:
                    stats["counts"].pop(0)
                if stats["timestamps"]:
                    stats["timestamps"].pop(0)
                if stats["latencies"]:
                    stats["latencies"].pop(0)
            if len(stats["latencies"]) > 100:
                stats["latencies"].pop(0)
            stats["current_stats"]["qps"] = calculate_qps(stats_key)
            stats["current_stats"]["latency"] = duration * 1000
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


async def get_database_size() -> float:
    async with postgres_pool.acquire() as conn:
        logger.debug("Querying database size...")
        size = await conn.fetchval("SELECT pg_database_size(current_database())")
        logger.debug(f"Raw database size (bytes): {size}")
        if size is None:
            logger.error("Database size query returned None")
            return 0.0
        size_gb = size / (1024 * 1024 * 1024)
        logger.debug(f"Database size: {size_gb:.2f} GB")
        return size_gb


async def get_query_metrics(product_id: int) -> Dict:
    current_time = time.time()
    response = {'timestamp': int(current_time * 1000), 'isolation_level': current_isolation_level}
    try:
        async with postgres_pool.acquire() as pg_conn:
            mv_freshness = await pg_conn.fetchrow("""
                SELECT EXTRACT(EPOCH FROM (NOW() - last_refresh)) as age,
                       refresh_duration
                FROM materialized_view_refresh_log
                WHERE view_name = 'mv_dynamic_pricing'
            """)
            pg_heartbeat = await pg_conn.fetchrow("""
                SELECT id, ts, NOW() as current_ts
                FROM heartbeats
                ORDER BY id DESC
                LIMIT 1
            """)
        materialize_lag = 0.0
        try:
            async with materialize_pool.acquire() as mz_conn:
                logger.debug("Fetching Materialize heartbeat...")
                mz_heartbeat = await mz_conn.fetchrow(f'''
                    SELECT id, ts
                    FROM {mz_schema}.heartbeats
                    ORDER BY ts DESC
                    LIMIT 1
                ''')
                logger.debug(f"Materialize heartbeat: {mz_heartbeat}")
                if pg_heartbeat and mz_heartbeat:
                    pg_id = pg_heartbeat['id']
                    mz_id = mz_heartbeat['id']
                    if pg_id > mz_id:
                        lag = (pg_heartbeat['ts'] - mz_heartbeat['ts']).total_seconds()
                        lag += (pg_heartbeat['current_ts'] - pg_heartbeat['ts']).total_seconds()
                        materialize_lag = max(0.0, lag)
        except asyncio.TimeoutError:
            logger.warning("Timeout fetching Materialize metrics")
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
        for source in ['view', 'materialized_view', 'materialize']:
            stats = query_stats[source]["current_stats"]
            is_fresh = current_time - stats["last_updated"] <= 2.0
            response.update({
                f"{source}_latency": stats["latency"] if is_fresh else None,
                f"{source}_end_to_end_latency": stats["end_to_end_latency"] if is_fresh else None,
                f"{source}_price": stats["price"] if is_fresh else None,
                f"{source}_qps": stats["qps"] if is_fresh else None,
                f"{source}_stats": calculate_stats(query_stats[source]["latencies"]) if is_fresh else None,
                f"{source}_end_to_end_stats": calculate_stats(
                    query_stats[source]["end_to_end_latencies"]) if is_fresh else None
            })
            if source == 'materialized_view':
                refresh_durations = query_stats[source]["refresh_durations"]
                if refresh_durations and is_fresh:
                    refresh_stats = {
                        'max': max(refresh_durations),
                        'average': sum(refresh_durations) / len(refresh_durations),
                        'p99': sorted(refresh_durations)[int(len(refresh_durations) * 0.99)]
                        if len(refresh_durations) >= 100 else max(refresh_durations)
                    }
                else:
                    refresh_stats = None
                response.update({
                    'materialized_view_freshness': float(mv_freshness['age']) if mv_freshness and is_fresh else None,
                    'materialized_view_refresh_duration': float(
                        mv_freshness['refresh_duration']) if mv_freshness and is_fresh else None,
                    'materialized_view_refresh_stats': refresh_stats
                })
            elif source == 'materialize':
                response.update({'materialize_freshness': materialize_lag if is_fresh else None})
    except Exception as e:
        logger.error(f"Error in get_query_metrics: {str(e)}", exc_info=True)
        raise
    return response


async def toggle_promotion(product_id: int):
    try:
        async with postgres_pool.acquire() as conn:
            # First check if the product exists
            product_exists = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM products WHERE product_id = $1)",
                product_id
            )

            if not product_exists:
                return {
                    "status": "error",
                    "message": f"Product with ID {product_id} does not exist"
                }

            # Try to update existing promotion
            result = await conn.fetchrow("""
                UPDATE promotions
                SET active = NOT active,
                    updated_at = NOW()
                WHERE product_id = $1
                RETURNING updated_at, active
            """, product_id)

            # If no existing promotion, create a new one
            if not result:
                # Reset the sequence to the maximum value to avoid conflicts
                await conn.execute("""
                    SELECT setval('promotions_promotion_id_seq', 
                                COALESCE((SELECT MAX(promotion_id) FROM promotions), 0))
                """)

                result = await conn.fetchrow("""
                    INSERT INTO promotions (
                        product_id,
                        promotion_discount,
                        start_date,
                        end_date,
                        active,
                        updated_at
                    )
                    VALUES (
                        $1,
                        10.0,  -- Default 10% discount
                        NOW(),
                        NOW() + interval '30 days',
                        TRUE,
                        NOW()
                    )
                    RETURNING updated_at, active
                """, product_id)

            if not result:
                return {
                    "status": "error",
                    "message": "Failed to create or update promotion"
                }

            return {
                "status": "success",
                "updated_at": result["updated_at"],
                "active": result["active"]
            }
    except Exception as e:
        logger.error(f"Error in toggle_promotion for product_id {product_id}: {str(e)}")
        return {
            "status": "error",
            "message": f"Database error: {str(e)}"
        }


async def toggle_view_index():
    try:
        async with materialize_pool.acquire() as conn:
            if await check_materialize_index_exists():
                await conn.execute(f"DROP INDEX {mz_schema}.dynamic_pricing_product_id_idx")
                return {"message": "Index dropped successfully", "index_exists": False}
            else:
                await conn.execute(
                    f"CREATE INDEX dynamic_pricing_product_id_idx ON {mz_schema}.dynamic_pricing (product_id)")
                return {"message": "Index created successfully", "index_exists": True}
    except Exception as e:
        logger.error(f"Error toggling index: {str(e)}")
        raise Exception(f"Failed to toggle index: {str(e)}")


async def get_view_index_status():
    async with materialize_pool.acquire() as conn:
        index_exists = await conn.fetchval("""
            SELECT TRUE 
            FROM mz_catalog.mz_indexes
            WHERE name = 'dynamic_pricing_product_id_idx'
        """)
        return index_exists or False


async def get_isolation_level():
    async with materialize_pool.acquire() as conn:
        level = await conn.fetchval("SHOW transaction_isolation")
        return level.lower()


async def toggle_isolation_level():
    global current_isolation_level
    async with materialize_pool.acquire() as conn:
        new_level = "strict serializable" if current_isolation_level == "serializable" else "serializable"
        await conn.execute(f"SET TRANSACTION_ISOLATION TO '{new_level}'")
        current_isolation_level = new_level
        return {"status": "success", "isolation_level": new_level}


async def check_materialize_index_exists():
    max_retries = 3
    retry_delay = 1.0
    for attempt in range(max_retries):
        try:
            async with materialize_pool.acquire() as conn:
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
                retry_delay *= 2
            continue
        except Exception as e:
            logger.error(f"Error checking Materialize index: {str(e)}")
            return False
    return False


async def toggle_traffic(source: str) -> bool:
    global traffic_enabled
    traffic_enabled[source] = not traffic_enabled[source]
    logger.info(f"Traffic for {source} is now {'enabled' if traffic_enabled[source] else 'disabled'}")
    return traffic_enabled[source]


async def execute_query(source_key: str, is_materialize: bool, query: str, product_id: int):
    try:
        if not traffic_enabled[source_key]:
            return
        source_display = source_names[source_key]
        task = asyncio.create_task(measure_query_time(query, [product_id], is_materialize, source_display))
        active_tasks[source_key].add(task)
        try:
            await task
        finally:
            active_tasks[source_key].remove(task)
        max_concurrent = await get_concurrency_limits()
        if traffic_enabled[source_key] and len(active_tasks[source_key]) < max_concurrent[source_key]:
            asyncio.create_task(execute_query(source_key, is_materialize, query, product_id))
    except Exception as e:
        logger.error(f"Error executing query for {source_key}: {str(e)}", exc_info=True)


async def continuous_query_load():
    product_id = 1
    QUERIES = {
        'view': """
            SELECT product_id, adjusted_price, last_update_time
            FROM dynamic_pricing 
            WHERE product_id = $1
        """,
        'materialized_view': """
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
    while True:
        try:
            max_concurrent = await get_concurrency_limits()
            if len(active_tasks['view']) < max_concurrent['view']:
                asyncio.create_task(execute_query('view', False, QUERIES['view'], product_id))
            if len(active_tasks['materialized_view']) < max_concurrent['materialized_view']:
                asyncio.create_task(execute_query('materialized_view', False, QUERIES['materialized_view'], product_id))
            if len(active_tasks['materialize']) < max_concurrent['materialize']:
                asyncio.create_task(execute_query('materialize', True, QUERIES['materialize'], product_id))
            await asyncio.sleep(0.1)
        except Exception as e:
            logger.error(f"Error in continuous query load: {str(e)}", exc_info=True)
            await asyncio.sleep(1)


async def get_concurrency_limits():
    has_index = await check_materialize_index_exists()
    return {
        'view': 1,
        'materialized_view': 5,
        'materialize': 5 if has_index else 1
    }


async def update_freshness_metrics():
    while True:
        try:
            async with postgres_pool.acquire() as conn:
                logger.info(
                    f"Current Freshness Values:\n  - MV: {query_stats['materialized_view']['current_stats']['freshness']:.2f}s"
                    f"\n  - Materialize: {query_stats['materialize']['current_stats']['freshness']:.2f}s")
                try:
                    mv_stats = await conn.fetchrow("""
                        SELECT last_refresh, refresh_duration,
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
                            logger.debug(f"Updated MV freshness: {age:.2f}s (duration: {duration:.2f}s)")
                except Exception as e:
                    logger.error(f"Error updating MV freshness: {str(e)}")
            try:
                async with postgres_pool.acquire() as conn:
                    pg_heartbeat = await conn.fetchrow(f"""
                        SELECT id, ts, NOW() as current_ts
                        FROM {mz_schema}.heartbeats
                        ORDER BY ts DESC
                        LIMIT 1
                    """)
                async with materialize_pool.acquire() as conn:
                    mz_heartbeat = await conn.fetchrow(f"""
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
                            freshness = (pg_ts - mz_ts).total_seconds() + (current_ts - pg_ts).total_seconds()
                            stats["freshness"] = max(0.0, freshness)
                        else:
                            stats["freshness"] = 0.0
                        stats["last_updated"] = time.time()
                    logger.debug(
                        f"Updated Materialize freshness: {stats['freshness']:.2f}s (PG ID: {pg_id}, MZ ID: {mz_id})")
            except Exception as e:
                logger.error(f"Error updating Materialize freshness: {str(e)}")
            await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"Error in update_freshness_metrics: {str(e)}")
            await asyncio.sleep(1)


async def collect_container_stats():
    """Collect Docker container CPU and memory stats every 5 seconds."""
    logger.info("Starting container stats collection...")
    query_stats["postgres_stats"] = {
        "cpu_measurements": [],
        "memory_measurements": [],
        "timestamps": [],
        "current_stats": {"cpu_usage": 0.0, "memory_usage": 0.0, "last_updated": 0.0}
    }
    query_stats["materialize_stats"] = {
        "cpu_measurements": [],
        "memory_measurements": [],
        "timestamps": [],
        "current_stats": {"cpu_usage": 0.0, "memory_usage": 0.0, "last_updated": 0.0}
    }
    while True:
        try:
            current_time = time.time()
            containers = {"postgres_stats": "postgres", "materialize_stats": "materialize"}
            for stats_key, container_name in containers.items():
                logger.debug(f"Collecting Docker stats for {container_name}...")
                process = await asyncio.create_subprocess_exec(
                    'docker', 'stats', container_name, '--no-stream', '--format', '{{.CPUPerc}}\t{{.MemPerc}}',
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                returncode = await process.wait()
                if returncode != 0:
                    logger.error(f"Error getting Docker stats for {container_name}: {process.stderr.read()}")
                else:
                    stats_str = (await process.stdout.read()).decode("utf-8").strip().split('\t')
                    if len(stats_str) == 2:
                        cpu_str = stats_str[0].rstrip('%')
                        mem_str = stats_str[1].rstrip('%')
                        logger.debug(f"Raw stats from {container_name}: CPU={cpu_str}%, MEM={mem_str}%")
                        try:
                            cpu_usage = float(cpu_str)
                            mem_usage = float(mem_str)
                            async with stats_lock:
                                stats = query_stats[stats_key]
                                stats["cpu_measurements"].append(cpu_usage)
                                stats["memory_measurements"].append(mem_usage)
                                stats["timestamps"].append(current_time)
                                if len(stats["timestamps"]) > 100:
                                    stats["cpu_measurements"].pop(0)
                                    stats["memory_measurements"].pop(0)
                                    stats["timestamps"].pop(0)
                                stats["current_stats"].update({
                                    "cpu_usage": cpu_usage,
                                    "memory_usage": mem_usage,
                                    "last_updated": current_time
                                })
                                logger.debug(f"Updated {stats_key} stats: CPU={cpu_usage}%, MEM={mem_usage}%")
                        except ValueError as e:
                            logger.error(f"Error converting stats for {container_name}: {str(e)}")
                    else:
                        logger.error(f"Invalid stats format for {container_name}")
        except Exception as e:
            logger.error(f"Error collecting container stats: {str(e)}")
        await asyncio.sleep(5)


async def get_container_stats():
    """Return CPU and memory usage stats for PostgreSQL and Materialize."""
    current_time = time.time()
    response = {"timestamp": int(current_time * 1000)}
    for container_type in ["postgres_stats", "materialize_stats"]:
        stats = query_stats.get(container_type)
        if not stats:
            response[container_type] = {"cpu_usage": None, "memory_usage": None, "cpu_stats": None,
                                        "memory_stats": None}
            continue
        is_fresh = current_time - stats["current_stats"]["last_updated"] <= 10.0
        if not is_fresh:
            response[container_type] = {"cpu_usage": None, "memory_usage": None, "cpu_stats": None,
                                        "memory_stats": None}
            continue
        cpu_stats = None
        memory_stats = None
        if stats["cpu_measurements"]:
            cpu_stats = {
                "max": max(stats["cpu_measurements"]),
                "average": sum(stats["cpu_measurements"]) / len(stats["cpu_measurements"]),
                "p99": sorted(stats["cpu_measurements"])[int(len(stats["cpu_measurements"]) * 0.99)] if len(
                    stats["cpu_measurements"]) >= 100 else max(stats["cpu_measurements"])
            }
        if stats["memory_measurements"]:
            memory_stats = {
                "max": max(stats["memory_measurements"]),
                "average": sum(stats["memory_measurements"]) / len(stats["memory_measurements"]),
                "p99": sorted(stats["memory_measurements"])[int(len(stats["memory_measurements"]) * 0.99)] if len(
                    stats["memory_measurements"]) >= 100 else max(stats["memory_measurements"])
            }
        response[container_type] = {
            "cpu_usage": stats["current_stats"]["cpu_usage"],
            "memory_usage": stats["current_stats"]["memory_usage"],
            "cpu_stats": cpu_stats,
            "memory_stats": memory_stats
        }
    return response


async def get_traffic_state():
    """Return the current state of traffic toggles for all sources."""
    logger.debug("Getting traffic state")
    state = {
        "view": traffic_enabled["view"],
        "materialized_view": traffic_enabled["materialized_view"],
        "materialize": traffic_enabled["materialize"]
    }
    logger.debug(f"Current traffic state: {state}")
    return state


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
                            logger.info(f"Ignoring error during cleanup: {str(e)}")
                        finally:
                            self._closed = True

            if loop.is_running():
                logger.info("Cleanup: event loop is running, scheduling cleanup")
                loop.create_task(safe_cleanup())
            else:
                logger.info("Cleanup: event loop not running, running cleanup synchronously")
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

async def get_categories():
    """Get all product categories from the database."""
    try:
        async with postgres_pool.acquire() as conn:
            categories = await conn.fetch("""
                SELECT DISTINCT category_id, category_name 
                FROM categories 
                ORDER BY category_name
            """)
            return [dict(row) for row in categories]
    except Exception as e:
        logger.error(f"Error fetching categories: {str(e)}", exc_info=True)
        raise

async def add_product(product_name: str, category_id: int, price: float):
    """Add a new product to the database and to the shopping cart."""
    try:
        async with postgres_pool.acquire() as conn:
            async with conn.transaction():
                # First get the maximum product_id and add 1
                next_id = await conn.fetchval("""
                    SELECT COALESCE(MAX(product_id), 0) + 1 FROM products
                """)

                # Insert into products table
                result = await conn.fetchrow("""
                    INSERT INTO products (product_id, product_name, category_id, base_price, supplier_id, available, last_update_time)
                    VALUES ($1, $2, $3, $4, 1, true, NOW())
                    RETURNING product_id, product_name, category_id, base_price
                """, next_id, product_name, category_id, price)

                # Reset sequences to match current maximum values
                await conn.execute("""
                    SELECT setval('sales_sale_id_seq', COALESCE((SELECT MAX(sale_id) FROM sales), 0));
                    SELECT setval('promotions_promotion_id_seq', COALESCE((SELECT MAX(promotion_id) FROM promotions), 0));
                """)

                # Add initial sale record for the product
                await conn.execute("""
                    INSERT INTO sales (product_id, sale_date, price, sale_price)
                    VALUES ($1, NOW(), $2, $2)
                """, next_id, price)

                # Add the new product to the shopping cart
                await conn.execute("""
                    INSERT INTO shopping_cart (product_id, product_name, category_id, price)
                    VALUES ($1, $2, $3, $4)
                """, next_id, product_name, category_id, price)

                return dict(result)
    except Exception as e:
        logger.error(f"Error adding product: {str(e)}", exc_info=True)
        raise

async def get_category_subtotals():
    """Get subtotals for each category in the shopping cart."""
    try:
        async with materialize_pool.acquire() as conn:
            subtotals = await conn.fetch("""
                SELECT 
                    category_name,
                    item_count,
                    total as subtotal
                FROM category_totals
                ORDER BY category_name ASC
            """)
            return [dict(row) for row in subtotals]
    except Exception as e:
        logger.error(f"Error fetching category subtotals: {str(e)}", exc_info=True)
        raise
