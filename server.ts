import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
    enqueue,
    getJobs,
    getJob,
    getStats,
    deleteJob,
    retryJob,
    purgeCompleted,
    type ClaudeExtractionPayload,
} from "./queue";

function projectNameFromUrl(remoteUrl: string): string {
    return remoteUrl
        .split("/")
        .pop()!
        .replace(/\.git$/, "");
}

const PROJECTS_DIR = join(import.meta.dir, ".projects");

Bun.serve({
    port: 3000,
    routes: {
        "/healthz": new Response("ok"),
        "/api/project/init": {
            POST: async (req) => {
                const { remoteUrl } = (await req.json()) as {
                    remoteUrl: unknown;
                };

                if (!remoteUrl || typeof remoteUrl !== "string") {
                    return Response.json(
                        { error: "remoteUrl is required" },
                        { status: 400 }
                    );
                }

                const projectName = projectNameFromUrl(remoteUrl);
                const projectDir = join(PROJECTS_DIR, projectName);
                const referenceDir = join(projectDir, "reference");

                await mkdir(referenceDir, { recursive: true });

                const result =
                    await Bun.$`git clone ${remoteUrl} ${referenceDir}`.quiet();

                if (result.exitCode !== 0) {
                    return Response.json(
                        {
                            error: "git clone failed",
                            details: result.stderr.toString(),
                        },
                        { status: 500 }
                    );
                }

                console.log(`Cloned ${remoteUrl} into ${referenceDir}`);

                return Response.json({
                    ok: true,
                    projectName,
                    projectDir,
                    referenceDir,
                });
            },
        },
        "/api/project/cleanup": {
            POST: async (req) => {
                const { remoteUrl } = (await req.json()) as {
                    remoteUrl: unknown;
                };

                if (!remoteUrl || typeof remoteUrl !== "string") {
                    return Response.json(
                        { error: "remoteUrl is required" },
                        { status: 400 }
                    );
                }

                const projectName = projectNameFromUrl(remoteUrl);
                const projectDir = join(PROJECTS_DIR, projectName);

                // Check if the project directory exists
                const exists = await Bun.file(
                    join(projectDir, "reference/.git/HEAD")
                ).exists();

                if (!exists) {
                    return Response.json(
                        { error: "project not found", projectName },
                        { status: 404 }
                    );
                }

                await rm(projectDir, { recursive: true, force: true });
                console.log(`Deleted project ${projectName} at ${projectDir}`);

                return Response.json({
                    ok: true,
                    projectName,
                    deleted: projectDir,
                });
            },
        },

        // ============================================================
        // Jobs Queue API
        // ============================================================

        "/api/jobs": {
            GET: async (req) => {
                const { searchParams } = new URL(req.url);
                const status = searchParams.get("status") as
                    | "pending"
                    | "claimed"
                    | "completed"
                    | "failed"
                    | null;
                const type = searchParams.get("type");
                const limit = parseInt(
                    searchParams.get("limit") ?? "50",
                    10
                );
                const offset = parseInt(
                    searchParams.get("offset") ?? "0",
                    10
                );

                try {
                    const jobsList = await getJobs({
                        status: status ?? undefined,
                        type: type ?? undefined,
                        limit,
                        offset,
                    });
                    return Response.json({
                        jobs: jobsList,
                        count: jobsList.length,
                    });
                } catch (error) {
                    console.error("[API /jobs] GET error:", error);
                    return Response.json(
                        { error: "Failed to fetch jobs" },
                        { status: 500 }
                    );
                }
            },
            DELETE: async () => {
                try {
                    const purged = await purgeCompleted();
                    return Response.json({ success: true, purged });
                } catch (error) {
                    console.error("[API /jobs] DELETE error:", error);
                    return Response.json(
                        { error: "Failed to purge jobs" },
                        { status: 500 }
                    );
                }
            },
        },

        "/api/jobs/enqueue": {
            POST: async (req) => {
                try {
                    const body = (await req.json()) as {
                        prompt: string;
                        name?: string;
                        branch?: string;
                        originUrl?: string;
                        idempotencyKey?: string;
                    };

                    if (!body.prompt) {
                        return Response.json(
                            { error: "Missing required field: prompt" },
                            { status: 400 }
                        );
                    }

                    const jobName =
                        body.name ||
                        slugify(body.prompt.substring(0, 50)) +
                            `-${Date.now()}`;
                    const promptHash = hashString(body.prompt);

                    const payload: ClaudeExtractionPayload = {
                        type: "claude_extraction",
                        name: jobName,
                        prompt: body.prompt,
                        branch: body.branch ?? null,
                        targetPath: null,
                        originUrl: body.originUrl ?? null,
                        requirementId: null,
                        promptHash,
                    };

                    const job = await enqueue(payload, {
                        idempotencyKey:
                            body.idempotencyKey ??
                            `enqueue-${promptHash}-${Date.now()}`,
                    });

                    return Response.json({
                        success: true,
                        job: {
                            id: job.id,
                            name: jobName,
                            status: job.status,
                            createdAt: job.createdAt,
                        },
                    });
                } catch (error) {
                    console.error("[API /jobs/enqueue] Error:", error);
                    return Response.json(
                        { error: "Failed to enqueue job" },
                        { status: 500 }
                    );
                }
            },
        },

        "/api/jobs/stats": {
            GET: async () => {
                try {
                    const stats = await getStats();
                    return Response.json({ stats });
                } catch (error) {
                    console.error("[API /jobs/stats] error:", error);
                    return Response.json(
                        { error: "Failed to fetch stats" },
                        { status: 500 }
                    );
                }
            },
        },
    },

    // Handle dynamic routes: /api/jobs/:id and /api/jobs/:id/retry
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // POST /api/jobs/:id/retry
        const retryMatch = path.match(/^\/api\/jobs\/([^/]+)\/retry$/);
        if (retryMatch && req.method === "POST") {
            const id = retryMatch[1]!;
            try {
                const job = await retryJob(id);
                if (!job) {
                    return Response.json(
                        { error: "Job not found" },
                        { status: 404 }
                    );
                }
                return Response.json({ success: true, job });
            } catch (error) {
                console.error(`[API /jobs/${id}/retry] error:`, error);
                return Response.json(
                    { error: "Failed to retry job" },
                    { status: 500 }
                );
            }
        }

        // GET/DELETE /api/jobs/:id
        const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch) {
            const id = jobMatch[1]!;

            // Skip known sub-routes handled by static routes
            if (id === "enqueue" || id === "stats") {
                return new Response("Not Found", { status: 404 });
            }

            if (req.method === "GET") {
                try {
                    const job = await getJob(id);
                    if (!job) {
                        return Response.json(
                            { error: "Job not found" },
                            { status: 404 }
                        );
                    }
                    return Response.json({ job });
                } catch (error) {
                    console.error(`[API /jobs/${id}] GET error:`, error);
                    return Response.json(
                        { error: "Failed to fetch job" },
                        { status: 500 }
                    );
                }
            }

            if (req.method === "DELETE") {
                try {
                    const deleted = await deleteJob(id);
                    if (!deleted) {
                        return Response.json(
                            { error: "Job not found" },
                            { status: 404 }
                        );
                    }
                    return Response.json({ success: true, deleted: id });
                } catch (error) {
                    console.error(`[API /jobs/${id}] DELETE error:`, error);
                    return Response.json(
                        { error: "Failed to delete job" },
                        { status: 500 }
                    );
                }
            }
        }

        return new Response("Not Found", { status: 404 });
    },
});

// ============================================================================
// Helpers
// ============================================================================

function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 50);
}

function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

console.log("Server running on http://localhost:3000");
