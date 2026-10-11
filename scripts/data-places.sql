-- Run with DuckDB CLI. This fetches a bounded regional extract from public Overture GeoParquet.
-- The release and bounds must match src/data/manifest.json when regenerating the package.
INSTALL httpfs;
LOAD httpfs;
SET memory_limit = '512MB';
SET threads = 2;
COPY (
  SELECT id, names.primary AS name, taxonomy.primary AS category,
         taxonomy.hierarchy AS hierarchy, confidence, operating_status,
         addresses, websites, phones, bbox, sources
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN 7.674 AND 7.704
    AND bbox.ymin BETWEEN 45.087 AND 45.103
    AND (list_contains(taxonomy.hierarchy, 'food_and_drink') OR list_contains(taxonomy.hierarchy, 'shopping'))
) TO '/tmp/avoid-maps-places.json' (FORMAT JSON, ARRAY true);
