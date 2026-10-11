-- Template: python3 scripts/data-prepare.py --places-sql /path/to/raw.json
-- Release and bounds come only from the pinned places.source.json metadata.
-- Run the rendered output with DuckDB. This fetches a public bounded extract.
INSTALL httpfs;
LOAD httpfs;
SET memory_limit = '512MB';
SET threads = 2;
COPY (
  SELECT id, version, names, taxonomy, basic_category, confidence, operating_status,
         addresses, websites, phones, bbox, sources
  FROM read_parquet('s3://overturemaps-us-west-2/release/{{release}}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN {{minLongitude}} AND {{maxLongitude}}
    AND bbox.ymin BETWEEN {{minLatitude}} AND {{maxLatitude}}
    AND (list_contains(taxonomy.hierarchy, 'food_and_drink') OR list_contains(taxonomy.hierarchy, 'shopping'))
  ORDER BY id
) TO '{{output}}' (FORMAT JSON, ARRAY true);
