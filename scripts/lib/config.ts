import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, exists } from "node:fs/promises";

export const THOU_DIR = join(homedir(), ".thou");
const CONFIG_PATH = join(THOU_DIR, "config.json");
const PORT = 3000;

export interface ThouConfig {
    remote?: string; // just the host, e.g. "192.168.1.5" or "localhost"
}

export async function requireGlobalInit(): Promise<void> {
    if (!(await exists(THOU_DIR))) {
        console.error(
            "Not initialized. Run: bun scripts/global-init.ts"
        );
        process.exit(1);
    }
}

export async function readConfig(): Promise<ThouConfig> {
    const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) return {};
    return file.json();
}

export async function writeConfig(config: ThouConfig): Promise<void> {
    await mkdir(THOU_DIR, { recursive: true });
    await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/** Strips protocol, port, and trailing slashes to get a clean hostname. */
export function normalizeHost(input: string): string {
    return input
        .replace(/^https?:\/\//, "")
        .replace(/:\d+\/?$/, "")
        .replace(/\/+$/, "");
}

export async function getRemote(): Promise<string> {
    const config = await readConfig();
    if (!config.remote) {
        console.error("No remote set. Run: bun scripts/remotes.ts set <host>");
        process.exit(1);
    }
    return `http://${normalizeHost(config.remote)}:${PORT}`;
}

export async function healthcheck(): Promise<void> {
    const url = await getRemote();
    try {
        const res = await fetch(`${url}/healthz`);
        if (!res.ok) throw new Error(`status ${res.status}`);
    } catch {
        console.error(`Remote unreachable at ${url}`);
        process.exit(1);
    }
}
