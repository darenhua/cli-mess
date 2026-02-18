#!/usr/bin/env bun
// Runs project.init to init the project on the other server.

import { requireGlobalInit, getRemote, healthcheck } from "./lib/config";

async function main() {
  await requireGlobalInit();
  const API_URL = await getRemote();
  await healthcheck();

  const cwd = process.cwd();

  // 1. Check if this is a Next.js project
  const packageJsonFile = Bun.file(`${cwd}/package.json`);
  if (!(await packageJsonFile.exists())) {
    console.error("No package.json found in current directory. Is this a Node project?");
    process.exit(1);
  }

  const packageJson = await packageJsonFile.json();
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (!deps["next"]) {
    console.error("This doesn't appear to be a Next.js project (no 'next' in dependencies).");
    process.exit(1);
  }

  console.log("Next.js project detected.");

  // 2. Check for git repo
  const gitCheck = Bun.$`git -C ${cwd} rev-parse --is-inside-work-tree`.quiet();
  const gitResult = await gitCheck;

  if (gitResult.exitCode !== 0) {
    console.error("No git repository found in current directory.");
    process.exit(1);
  }

  // 3. Get git remote URL
  const remoteResult = await Bun.$`git -C ${cwd} remote get-url origin`.quiet();

  if (remoteResult.exitCode !== 0) {
    console.error("No git remote 'origin' found.");
    process.exit(1);
  }

  const remoteUrl = remoteResult.text().trim();
  console.log(`Git remote: ${remoteUrl}`);

  // 4. Send to our API
  const res = await fetch(`${API_URL}/api/project/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteUrl }),
  });

  if (!res.ok) {
    console.error(`API error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log("Project initialized:", data);
}

main();
