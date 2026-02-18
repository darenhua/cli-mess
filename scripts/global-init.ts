#!/usr/bin/env bun
// One-time setup: creates the ~/.thou directory structure.
// Aborts if ~/.thou already exists.

import { join } from "node:path";
import { mkdir, exists } from "node:fs/promises";
import { THOU_DIR } from "./lib/config";

async function main() {
    if (await exists(THOU_DIR)) {
        console.error(`${THOU_DIR} already exists. Aborting.`);
        process.exit(1);
    }

    // Create directory structure
    await Promise.all([
        mkdir(join(THOU_DIR, "staging"), { recursive: true }),
        mkdir(join(THOU_DIR, "gallery"), { recursive: true }),
        mkdir(join(THOU_DIR, "run"), { recursive: true }),
    ]);

    // Write empty config
    await Bun.write(join(THOU_DIR, "config.json"), "{}\n");

    console.log(`Initialized ${THOU_DIR}`);
}

main();
