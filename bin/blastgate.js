#!/usr/bin/env node
import { main } from '../src/cli.js';
import { PolicyError } from '../src/policy.js';
import { YamlError } from '../src/yaml.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`blastgate needs Node.js 18 or newer (found ${process.versions.node})`);
  process.exit(1);
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0; },
  (err) => {
    if (err instanceof PolicyError || err instanceof YamlError || err instanceof SyntaxError) {
      console.error(`blastgate: ${err.message}`);
    } else {
      console.error(err?.stack ?? err);
    }
    process.exitCode = 1;
  },
);
