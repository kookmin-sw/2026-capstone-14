#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  buildTrainingExport
} = require('../public/js/workout/phase-dataset-utils.js');

function parseArgs(argv) {
  const args = {
    session: null,
    labels: null,
    output: null
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--session') {
      args.session = next;
      index++;
    } else if (token === '--labels') {
      args.labels = next;
      index++;
    } else if (token === '--output') {
      args.output = next;
      index++;
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.session || !args.labels) {
    console.error('Usage: node scripts/build-phase-training-data.js --session raw-session.json --labels labels.json [--output merged.json]');
    process.exit(1);
  }

  const rawSession = readJson(args.session);
  const labels = readJson(args.labels);
  const rawDataset = rawSession.raw || rawSession.phase_dataset || rawSession;
  const merged = buildTrainingExport(rawDataset, labels);
  const result = JSON.stringify(merged, null, 2);

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), result);
    console.log(`Merged dataset written to ${args.output}`);
    return;
  }

  process.stdout.write(result);
}

main();
