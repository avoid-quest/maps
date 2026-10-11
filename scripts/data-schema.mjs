// Rebuild the bundled protobuf schema from an explicitly downloaded upstream .proto file.
// Usage: node scripts/data-schema.mjs /path/to/gtfs-realtime.proto
import fs from 'node:fs';
import protobuf from 'protobufjs';
if (!process.argv[2]) throw new Error('Pass the official GTFS-Realtime .proto path. Preserve its Apache licence notice in src/data/licenses.json.');
const root = protobuf.parse(fs.readFileSync(process.argv[2], 'utf8')).root;
fs.writeFileSync('src/data/gtfs-realtime-schema.json', `${JSON.stringify(root.toJSON())}\n`);
