from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from pydantic import BaseModel
from typing import Optional

from . import database
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure uvicorn access logger
uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.setLevel(logging.WARNING)

app = FastAPI()

# Global variable to store the refresh task
refresh_task = None
default_refresh_interval = 60

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    await database.init_pools()

    # Start the heartbeat task
    asyncio.create_task(database.create_heartbeat())
    # Start the auto-refresh task
    asyncio.create_task(database.auto_refresh_materialized_view())
    # Start the continuous query load task
    asyncio.create_task(database.continuous_query_load())
    # Start the container stats collection task
    asyncio.create_task(database.collect_container_stats())
    # Start the continuous shopping cart task
    asyncio.create_task(database.add_to_cart())
    # Start the inventory update task
    asyncio.create_task(database.update_inventory_levels())

    logger.info(
        "Started background tasks: heartbeat, materialized view auto-refresh, continuous query load, shopping cart, inventory updates, and container stats collection")


@app.post("/configure-refresh-interval/{interval}")
async def configure_refresh_interval(interval: int):
    global refresh_task
    if interval < 1:
        raise HTTPException(status_code=400, detail="Interval must be at least 1 second")

    # Update the global refresh interval in the database module
    await database.configure_refresh_interval(interval)

    # Cancel the existing refresh task
    if refresh_task:
        refresh_task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass

    # Start a new refresh task
    refresh_task = asyncio.create_task(database.auto_refresh_materialized_view())
    return {"status": "success", "refresh_interval": interval}


@app.get("/metrics/{product_id}")
async def get_metrics(product_id: int):
    try:
        metrics = await database.get_query_metrics(product_id)
        return metrics
    except asyncio.TimeoutError:
        logger.error("Metrics request timed out")
        raise HTTPException(
            status_code=504,
            detail="Request timed out"
        )
    except asyncio.CancelledError:
        logger.error("Metrics request was cancelled")
        raise HTTPException(
            status_code=499,  # Client Closed Request
            detail="Request was cancelled"
        )
    except Exception as e:
        logger.error(f"Error getting metrics: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


@app.post("/refresh")
async def refresh_materialized_view():
    try:
        await database.refresh_materialized_view()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/toggle-promotion/{product_id}")
async def toggle_promotion(product_id: int):
    try:
        return await database.toggle_promotion(product_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/toggle-view-index")
async def api_toggle_view_index():
    return await database.toggle_view_index()


@app.post("/toggle-isolation")
async def api_toggle_isolation():
    return await database.toggle_isolation_level()


@app.get("/view-index-status")
async def get_view_index_status():
    try:
        exists = await database.get_view_index_status()
        return {"index_exists": exists}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/database-size")
async def get_database_size_endpoint():
    """Get the current database size in GB"""
    try:
        size = await database.get_database_size()
        return {"size_gb": size}
    except Exception as e:
        logger.error(f"Error getting database size: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to get database size"
        )


@app.get("/current-refresh-interval")
async def get_current_refresh_interval():
    """Get the current refresh interval for the materialized view"""
    try:
        return {
            "status": "success",
            "refresh_interval": database.refresh_interval
        }
    except Exception as e:
        logger.error(f"Error getting refresh interval: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to get refresh interval"
        )


# Add traffic-related endpoints
@app.get("/api/traffic-state")
async def get_traffic_state():
    """Get the current state of traffic toggles for all sources"""
    try:
        logger.debug("Getting traffic state")
        state = await database.get_traffic_state()
        logger.debug(f"Current traffic state: {state}")
        return state
    except Exception as e:
        logger.error(f"Error getting traffic state: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/toggle-traffic/{source}")
async def toggle_traffic_endpoint(source: str):
    """Toggle traffic for a specific source"""
    try:
        logger.debug(f"Toggling traffic for source: {source}")
        result = await database.toggle_traffic(source)
        logger.debug(f"Toggle result: {result}")
        return result
    except ValueError as e:
        logger.error(f"Invalid source for traffic toggle: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error toggling traffic: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/container-stats")
async def get_containers_stats():
    """Get CPU and memory usage stats for PostgreSQL and Materialize"""
    try:
        logger.debug("Getting container stats")
        stats = await database.get_container_stats()
        logger.debug(f"Container stats: {stats}")
        return stats
    except Exception as e:
        logger.error(f"Error getting container stats: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/database-size")
async def get_database_size_endpoint():
    """Get the current database size in GB"""
    try:
        size = await database.get_database_size()
        return {"size_gb": size}
    except Exception as e:
        logger.error(f"Error getting database size: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/current-refresh-interval")
async def get_current_refresh_interval():
    """Get the current refresh interval for the materialized view"""
    try:
        return {
            "status": "success",
            "refresh_interval": database.refresh_interval
        }
    except Exception as e:
        logger.error(f"Error getting refresh interval: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/configure-refresh-interval/{interval}")
async def configure_refresh_interval(interval: int):
    """Configure the refresh interval for the materialized view"""
    try:
        await database.configure_refresh_interval(interval)
        return {"status": "success", "message": f"Refresh interval set to {interval} seconds"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error configuring refresh interval: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/shopping-cart")
async def get_shopping_cart(expanded=Query(None)):
    async with database.materialize_pool.acquire() as conn:
        try:
            # Start a transaction
            async with conn.transaction():
                # Get cart items
                cart_items = await conn.fetch("""
                    SELECT * FROM dynamic_price_shopping_cart
                    ORDER BY price DESC
                """)

                # Calculate cart total with exact precision
                cart_total = await conn.fetchval("""
                    WITH raw_total AS (
                        SELECT SUM(price)::numeric(20,10) as total
                        FROM dynamic_price_shopping_cart
                    )
                    SELECT ROUND(total, 2)
                    FROM raw_total
                """) or 0

                # Get category subtotals with exact precision
                clause = ""
                if expanded:
                    expanded_ids = ",".join([token.strip() for token in expanded.split(",") if token.strip().isdigit()])
                    clause = f"OR parent_id IN ({expanded_ids})"

                subtotals = await conn.fetch(f"""
                    WITH raw_totals AS (
                        SELECT
                            category_id, 
                            parent_id,
                            has_subcategory, 
                            category_name,
                            item_count,
                            total::numeric(20,10) as raw_total
                        FROM category_totals
                        WHERE parent_id IS NULL {clause}
                    ),
                    category_data AS (
                        SELECT
                            category_id, 
                            parent_id,
                            has_subcategory, 
                            category_name,
                            item_count,
                            ROUND(raw_total, 2) AS subtotal
                        FROM raw_totals
                    ),
                    total_calc AS (
                        SELECT SUM(raw_total)::numeric(20,10) as total
                        FROM raw_totals 
                        WHERE parent_id IS NULL
                    )
                    SELECT
                        category_id, 
                        parent_id,
                        has_subcategory, 
                        category_name,
                        item_count,
                        subtotal,
                        ROUND((SELECT total FROM total_calc), 2) as categories_total
                    FROM category_data
                    ORDER BY coalesce(parent_id, category_id), category_id;
                """)

                # Extract the final values
                categories_total = float(subtotals[0]["categories_total"]) if subtotals else 0

                response_data = {
                    "cart_items": [dict(row) for row in cart_items],
                    "category_subtotals": [dict(row) for row in subtotals],
                    "cart_total": cart_total,
                    "categories_total": categories_total
                }
                return response_data
        except Exception as e:
            logger.error(f"Error fetching shopping cart data: {e}")
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/shopping-cart/category-subtotals")
async def get_category_subtotals():
    """This endpoint is deprecated. Use /api/shopping-cart instead."""
    raise HTTPException(
        status_code=301,
        detail="This endpoint is deprecated. Use /api/shopping-cart instead."
    )


@app.get("/api/mz-status")
async def get_mz_status():
    async with database.materialize_pool.acquire() as conn:
        result = await conn.fetchval("""
            SELECT count(*) > 0 
            FROM mz_internal.mz_source_status_history 
            JOIN mz_sources ON id = source_id
            WHERE type = 'postgres' AND status IN ('failed', 'stalled');
        """)
        return {"restart": result}


class ProductCreate(BaseModel):
    product_name: str
    category_id: int
    price: float


@app.get("/api/categories")
async def get_categories():
    """Get all available product categories"""
    try:
        categories = await database.get_categories()
        return categories
    except Exception as e:
        logger.error(f"Error getting categories: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to get categories"
        )


@app.post("/api/products")
async def add_product(product: ProductCreate):
    """Add a new product to the database"""
    try:
        new_product = await database.add_product(
            product.product_name,
            product.category_id,
            product.price
        )
        return new_product
    except Exception as e:
        logger.error(f"Error adding product: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to add product"
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="debug", access_log=False)
