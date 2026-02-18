#!/usr/bin/env bun
// Submit a reverse-engineering job to the server.
//
// Usage:
//   bun scripts/reverse.ts <prompt-file>
//   cat prompt.md | bun scripts/reverse.ts

import { requireGlobalInit, getRemote, healthcheck } from "./lib/config";

async function main() {
    await requireGlobalInit();
    const API_URL = await getRemote();
    await healthcheck();

    const cwd = process.cwd();

    // Check for git repo
    const gitResult =
        await Bun.$`git -C ${cwd} rev-parse --is-inside-work-tree`.quiet();
    if (gitResult.exitCode !== 0) {
        console.error("No git repository found in current directory.");
        process.exit(1);
    }

    // Get remote URL
    const remoteResult =
        await Bun.$`git -C ${cwd} remote get-url origin`.quiet();
    if (remoteResult.exitCode !== 0) {
        console.error("No git remote 'origin' found.");
        process.exit(1);
    }
    const remoteUrl = remoteResult.text().trim();

    // Read prompt from file arg or stdin
    const promptArg = process.argv[2];
    let prompt: string;

    if (promptArg) {
        const file = Bun.file(promptArg);
        if (!(await file.exists())) {
            console.error(`File not found: ${promptArg}`);
            process.exit(1);
        }
        prompt = await file.text();
    } else {
        prompt = await Bun.stdin.text();
    }

    prompt = prompt.trim();
    if (!prompt) {
        console.error(
            "Empty prompt. Usage: bun scripts/reverse.ts <prompt-file>"
        );
        process.exit(1);
    }

    console.log(`Git remote: ${remoteUrl}`);
    console.log(`Prompt: ${prompt.length} chars`);

    // Submit job
    const res = await fetch(`${API_URL}/api/jobs/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteUrl, prompt }),
    });

    if (!res.ok) {
        console.error(`API error: ${res.status} ${await res.text()}`);
        process.exit(1);
    }

    const { job } = (await res.json()) as {
        job: { id: string; status: string };
    };

    console.log(`Job enqueued: ${job.id}`);
    console.log(`Check status: curl ${API_URL}/api/jobs/${job.id}`);
}

main();
