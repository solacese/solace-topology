import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const source = path.join(root, "config", "topology.yaml");
const targetDir = path.join(root, "apps", "web", "public");
const target = path.join(targetDir, "demo-config.json");

const config = YAML.parse(await fs.readFile(source, "utf8"));
await fs.mkdir(targetDir, { recursive: true });
await fs.writeFile(target, JSON.stringify(config, null, 2));
console.log(`Wrote ${target}`);
