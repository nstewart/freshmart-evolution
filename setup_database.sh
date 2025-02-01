#!/bin/bash

# Exit on error
set -e

# Load environment variables
set -a
source backend/.env
set +a

# Function to show usage
show_usage() {
    echo "Usage: $0 [postgres|materialize|all]"
    echo "  postgres     - Setup PostgreSQL database only"
    echo "  materialize  - Setup Materialize only"
    echo "  all         - Setup both (default)"
    exit 1
}

# Function to setup PostgreSQL
setup_postgres() {
    echo "Creating data directory..."
    mkdir -p data
    cp -v data_files/*.csv data/

    echo "Cleaning up existing replication slots..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d postgres << EOF
    -- First terminate any active connections to the target database
    SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE datname = '$DB_NAME'
    AND pid <> pg_backend_pid();

    -- Then drop all replication slots
    DO \$\$
    DECLARE
        _slot_name text;
    BEGIN
        FOR _slot_name IN SELECT slot_name FROM pg_replication_slots
        LOOP
            PERFORM pg_drop_replication_slot(_slot_name);
            RAISE NOTICE 'Dropped replication slot: %', _slot_name;
        END LOOP;
    END \$\$;
EOF

    echo "Creating database..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -c "DROP DATABASE IF EXISTS $DB_NAME;"
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -c "CREATE DATABASE $DB_NAME;"

    echo "Loading base schema..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f base_tables.sql

    echo "Setting session timeouts..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
    -- Set session-level timeouts
    SET statement_timeout = 0;  -- Disable statement timeout
    SET idle_in_transaction_session_timeout = 0;  -- Disable idle timeout
    SET lock_timeout = 0;  -- Disable lock timeout
    SET command_timeout = 0;  -- Disable command timeout
    ALTER DATABASE $DB_NAME SET statement_timeout = 0;  -- Set default for new sessions
    ALTER DATABASE $DB_NAME SET idle_in_transaction_session_timeout = 0;
    ALTER DATABASE $DB_NAME SET lock_timeout = 0;
    -- Also set this at the role level
    ALTER ROLE $DB_USER SET statement_timeout = 0;
    ALTER ROLE $DB_USER SET idle_in_transaction_session_timeout = 0;
    ALTER ROLE $DB_USER SET lock_timeout = 0;
EOF

    echo "Loading initial data..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
\COPY categories(category_id,category_name) FROM 'data/categories.csv' WITH CSV HEADER;
\COPY suppliers(supplier_id,supplier_name) FROM 'data/suppliers.csv' WITH CSV HEADER;
\COPY products(product_id,product_name,base_price,category_id,supplier_id,available,last_update_time) FROM 'data/products.csv' WITH CSV HEADER;
\COPY inventory(inventory_id,product_id,stock,warehouse_id,restock_date) FROM 'data/inventory.csv' WITH CSV HEADER;
\COPY promotions(promotion_id,product_id,promotion_discount,start_date,end_date,active,updated_at) FROM 'data/promotions.csv' WITH CSV HEADER;
EOF

    echo "Preparing for sales data import..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
    -- Disable triggers and indices
    ALTER TABLE sales DISABLE TRIGGER ALL;
    DROP INDEX IF EXISTS idx_sales_product_id;
    DROP INDEX IF EXISTS idx_sales_sale_date;
    DROP INDEX IF EXISTS idx_sales_product_id_sale_date;

    -- Create unlogged table for better performance
    CREATE UNLOGGED TABLE temp_sales (LIKE sales INCLUDING ALL);
EOF

    echo "Loading sales data from chunks..."
    for chunk in data_files/sales_chunks/sales_part_*.csv; do
        if [ -f "$chunk" ]; then
            echo "Processing chunk: $chunk"
            PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
            TRUNCATE temp_sales;
            \COPY temp_sales FROM '${chunk}' WITH CSV HEADER;
            INSERT INTO sales SELECT * FROM temp_sales;
EOF
        fi
    done

    echo "Finalizing sales data import..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
    -- Drop temporary table
    DROP TABLE IF EXISTS temp_sales;

    -- Recreate indices
    CREATE INDEX CONCURRENTLY idx_sales_product_id ON sales(product_id);
    CREATE INDEX CONCURRENTLY idx_sales_sale_date ON sales(sale_date);
    CREATE INDEX CONCURRENTLY idx_sales_product_id_sale_date ON sales(product_id, sale_date);

    -- Re-enable triggers
    ALTER TABLE sales ENABLE TRIGGER ALL;

    -- Analyze
    ANALYZE sales;
EOF

    echo "Setting up PostgreSQL for Materialize..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
    -- Create publication for Materialize
    DROP PUBLICATION IF EXISTS mz_source;
    CREATE PUBLICATION mz_source FOR ALL TABLES;

    -- Ensure logical replication is enabled for all tables
    ALTER TABLE categories REPLICA IDENTITY FULL;
    ALTER TABLE suppliers REPLICA IDENTITY FULL;
    ALTER TABLE products REPLICA IDENTITY FULL;
    ALTER TABLE sales REPLICA IDENTITY FULL;
    ALTER TABLE inventory REPLICA IDENTITY FULL;
    ALTER TABLE promotions REPLICA IDENTITY FULL;
    ALTER TABLE heartbeats REPLICA IDENTITY FULL;
    ALTER TABLE materialized_view_refresh_log REPLICA IDENTITY FULL;
EOF

    echo "Cleaning up PostgreSQL temporary files..."
    rm -f data/sales_chunk_*

    echo "PostgreSQL setup complete!"
}

# Function to setup Materialize
setup_materialize() {
    echo "Setting up Materialize..."
    # Create a temporary file for Materialize setup
    cat > mz_setup.sql << EOF
    -- Drop existing objects if they exist
    DROP VIEW IF EXISTS dynamic_pricing CASCADE;
    DROP SOURCE IF EXISTS freshmart CASCADE;
    DROP CONNECTION IF EXISTS pg_connection CASCADE;
    DROP SECRET IF EXISTS pgpass CASCADE;

    -- Create Materialize objects
    CREATE SECRET pgpass AS '$DB_PASSWORD';

    CREATE CONNECTION pg_connection TO POSTGRES (
       HOST 'host.docker.internal',
       PORT 5432,
       USER '$DB_USER',
       PASSWORD SECRET pgpass,
       DATABASE '$DB_NAME'
    );

    CREATE SOURCE freshmart
    FROM POSTGRES CONNECTION pg_connection (PUBLICATION 'mz_source')
    FOR ALL TABLES;
EOF

    echo "Applying Materialize setup..."
    psql -h localhost -p 6875 -U materialize -d materialize -f mz_setup.sql

    echo "Loading Materialize views..."
    # Filter out the connection setup from mz_queries.sql and apply only the view definitions
    sed -n '/CREATE VIEW/,$p' mz_queries.sql > mz_views_only.sql
    psql -h localhost -p 6875 -U materialize -d materialize -f mz_views_only.sql

    echo "Cleaning up Materialize temporary files..."
    rm -f mz_setup.sql mz_views_only.sql

    echo "Materialize setup complete!"
}

# Parse command line argument
MODE=${1:-all}

case $MODE in
    postgres)
        setup_postgres
        ;;
    materialize)
        setup_materialize
        ;;
    all)
        setup_postgres
        setup_materialize
        ;;
    *)
        show_usage
        ;;
esac 
