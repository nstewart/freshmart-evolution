from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from . import database
import logging
import time

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
    # Start the heartbeat task
    asyncio.create_task(database.create_heartbeat())
    # Start the auto-refresh task
    asyncio.create_task(database.auto_refresh_materialized_view())
    # Start the continuous query load task
    asyncio.create_task(database.continuous_query_load())
    print("Started background tasks: heartbeat, materialized view auto-refresh, and continuous query load")

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
async def get_database_size():
    try:
        logger.debug("Received request for database size")
        size = await database.get_database_size()
        logger.debug(f"Database size query returned: {size:.2f} GB")
        return {"size_gb": round(size, 2)}
    except Exception as e:
        logger.error(f"Error getting database size: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to get database size"
        )

@app.get("/postgres-cpu")
async def get_postgres_cpu():
    """Endpoint to get PostgreSQL CPU usage"""
    try:
        cpu_usage = await database.get_postgres_cpu_stats()
        if cpu_usage is None:
            raise HTTPException(status_code=500, detail="Failed to get CPU stats")
            
        return {
            "timestamp": int(time.time() * 1000),
            "cpu_usage": cpu_usage
        }
    except Exception as e:
        logger.error(f"Error in CPU stats endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="debug", access_log=False)
