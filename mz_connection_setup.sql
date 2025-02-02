-- Create secret for PostgreSQL connection
CREATE SECRET IF NOT EXISTS pg_pass AS 'mysecret';

-- Create connection to PostgreSQL
CREATE CONNECTION IF NOT EXISTS pg_conn TO POSTGRES (
    HOST 'postgres',
    PORT 5432,
    USER 'postgres',
    DATABASE 'freshmart',
    PASSWORD SECRET pg_pass
);

-- Create source from PostgreSQL
CREATE SOURCE IF NOT EXISTS pg_src FROM POSTGRES CONNECTION pg_conn (
    PUBLICATION mz_source
) FOR ALL TABLES; 