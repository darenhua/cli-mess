#!/usr/bin/env bun
// Manage the remote server address stored in ~/.thou/config.json
//
// Usage:
//   bun scripts/remotes.ts set <host>   — set the remote (e.g. 192.168.1.5)
//   bun scripts/remotes.ts get          — print the current remote
//   bun scripts/remotes.ts clear        — remove the remote

import { requireGlobalInit, readConfig, writeConfig, normalizeHost } from "./lib/config";

const [command, value] = process.argv.slice(2);

async function main() {
    await requireGlobalInit();
    switch (command) {
        case "set": {
            if (!value) {
                console.error("Usage: bun scripts/remotes.ts set <host>");
                process.exit(1);
            }
            const host = normalizeHost(value);
            const config = await readConfig();
            config.remote = host;
            await writeConfig(config);
            console.log(`Remote set to ${host}`);
            break;
        }
        case "get": {
            const config = await readConfig();
            if (!config.remote) {
                console.error("No remote set.");
                process.exit(1);
            }
            console.log(config.remote);
            break;
        }
        case "clear": {
            const config = await readConfig();
            delete config.remote;
            await writeConfig(config);
            console.log("Remote cleared.");
            break;
        }
        default:
            console.error(
                "Usage: bun scripts/remotes.ts <set|get|clear> [host]"
            );
            process.exit(1);
    }
}

main();
