#!/bin/bash

# Create the sales_chunks directory if it doesn't exist
mkdir -p data_files/sales_chunks

# Get the header from the original file
head -n 1 data_files/sales.csv > data_files/sales_chunks/header

# Split the file (excluding header) into chunks of 1 million lines each
tail -n +2 data_files/sales.csv | split -l 1000000 - data_files/sales_chunks/chunk_

# Add header to each chunk
for chunk in data_files/sales_chunks/chunk_*; do
    cat data_files/sales_chunks/header "$chunk" > "$chunk.tmp" && mv "$chunk.tmp" "$chunk"
done

# Remove the temporary header file
rm data_files/sales_chunks/header

echo "Sales data has been split into chunks in data_files/sales_chunks/" 