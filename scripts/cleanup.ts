#!/usr/bin/env bun
// Cleans up the project on the server by detecting the git remote from cwd.

import { requireGlobalInit, getRemote, healthcheck } from "./lib/config";

async function main() {
  await requireGlobalInit();
  const API_URL = await getRemote();
  await healthcheck();

  const cwd = process.cwd();

  // 1. Check for git repo
  const gitResult = await Bun.$`git -C ${cwd} rev-parse --is-inside-work-tree`.quiet();

  if (gitResult.exitCode !== 0) {
    console.error("No git repository found in current directory.");
    process.exit(1);
  }

  // 2. Get git remote URL
  const remoteResult = await Bun.$`git -C ${cwd} remote get-url origin`.quiet();

  if (remoteResult.exitCode !== 0) {
    console.error("No git remote 'origin' found.");
    process.exit(1);
  }

  const remoteUrl = remoteResult.text().trim();
  console.log(`Git remote: ${remoteUrl}`);

  // 3. Send cleanup request
  const res = await fetch(`${API_URL}/api/project/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteUrl }),
  });

  if (!res.ok) {
    console.error(`API error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log("Project cleaned up:", data);
}

main();
