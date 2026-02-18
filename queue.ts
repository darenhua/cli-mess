import { db, jobs, eq, and, lt, desc, asc, sql } from "./db";
import type { Job } from "./schema";

// ============================================================================
// Payload Types
// ============================================================================

export type ClaudeExtractionPayload = {
    type: "claude_extraction";
    name: string;
    prompt: string;
    branch: string | null;
    targetPath: string | null;
    originUrl: string | null;
    requirementId: string | null;
    promptHash: string;
};

export type CreateFilePayload = {
    type: "create_file";
    path: string;
    content: string;
    overwrite?: boolean;
};

export type DeleteFilePayload = {
    type: "delete_file";
    path: string;
    requireExists?: boolean;
};

export type SyncAwsPayload = {
    type: "sync_aws";
    resourceType: string;
    resourceId: string;
    config: Record<string, unknown>;
};

export type EchoPayload = {
    type: "echo";
    message: string;
};

export type JobPayload =
    | ClaudeExtractionPayload
    | CreateFilePayload
    | DeleteFilePayload
    | SyncAwsPayload
    | EchoPayload;

export type JobType = JobPayload["type"];

export type EnqueueOptions = {
    priority?: number;
    maxAttempts?: number;
    idempotencyKey?: string;
};

export type ClaimResult = {
    job: Job;
    payload: JobPayload;
} | null;

export type JobStats = {
    pending: number;
    claimed: number;
    completed: number;
    failed: number;
    total: number;
};

export type JobFilter = {
    status?: Job["status"];
    type?: string;
    limit?: number;
    offset?: number;
};

// ============================================================================
// Helpers
// ============================================================================

const LOCK_TIMEOUT_MINUTES = 5;

function generateId(): string {
    return crypto.randomUUID();
}

function nowISO(): string {
    return new Date().toISOString();
}

// ============================================================================
// Enqueue
// ============================================================================

export async function enqueue(
    payload: JobPayload,
    options: EnqueueOptions = {}
): Promise<Job> {
    const { priority = 0, maxAttempts = 3, idempotencyKey } = options;

    if (idempotencyKey) {
        const existing = await db
            .select()
            .from(jobs)
            .where(
                and(
                    eq(jobs.type, payload.type),
                    eq(jobs.idempotencyKey, idempotencyKey)
                )
            )
            .limit(1);

        if (existing.length > 0) {
            const job = existing[0]!;
            if (job.status === "pending" || job.status === "claimed") {
                return job;
            }
        }
    }

    const id = generateId();
    const now = nowISO();

    const [job] = await db
        .insert(jobs)
        .values({
            id,
            type: payload.type,
            payload: payload as unknown as Record<string, unknown>,
            status: "pending",
            priority,
            attempts: 0,
            maxAttempts,
            idempotencyKey,
            createdAt: now,
        })
        .returning();

    return job!;
}

// ============================================================================
// Claim
// ============================================================================

export async function claim(workerId: string): Promise<ClaimResult> {
    const now = nowISO();

    const result = await db
        .update(jobs)
        .set({
            status: "claimed",
            lockedBy: workerId,
            lockedAt: now,
            claimedAt: now,
            attempts: sql`${jobs.attempts} + 1`,
        })
        .where(
            and(
                eq(jobs.status, "pending"),
                eq(
                    jobs.id,
                    sql`(
                        SELECT id FROM jobs
                        WHERE status = 'pending'
                        ORDER BY priority DESC, created_at ASC
                        LIMIT 1
                    )`
                )
            )
        )
        .returning();

    if (result.length === 0) return null;

    const job = result[0]!;
    return { job, payload: job.payload as JobPayload };
}

// ============================================================================
// Complete
// ============================================================================

export async function complete(jobId: string): Promise<Job | null> {
    const [job] = await db
        .update(jobs)
        .set({
            status: "completed",
            completedAt: nowISO(),
            lockedBy: null,
            lockedAt: null,
        })
        .where(eq(jobs.id, jobId))
        .returning();

    return job ?? null;
}

// ============================================================================
// Fail (with retry logic)
// ============================================================================

export async function fail(
    jobId: string,
    error: string
): Promise<Job | null> {
    const [current] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId));

    if (!current) return null;

    const attempts = current.attempts ?? 0;
    const maxAttempts = current.maxAttempts ?? 3;

    if (attempts >= maxAttempts) {
        const [job] = await db
            .update(jobs)
            .set({
                status: "failed",
                lastError: error,
                completedAt: nowISO(),
                lockedBy: null,
                lockedAt: null,
            })
            .where(eq(jobs.id, jobId))
            .returning();
        return job ?? null;
    }

    const [job] = await db
        .update(jobs)
        .set({
            status: "pending",
            lastError: error,
            lockedBy: null,
            lockedAt: null,
        })
        .where(eq(jobs.id, jobId))
        .returning();

    return job ?? null;
}

// ============================================================================
// Reclaim Stale Locks
// ============================================================================

export async function reclaimStaleLocks(): Promise<number> {
    const cutoff = new Date(
        Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000
    ).toISOString();

    const result = await db
        .update(jobs)
        .set({
            status: "pending",
            lockedBy: null,
            lockedAt: null,
        })
        .where(and(eq(jobs.status, "claimed"), lt(jobs.lockedAt, cutoff)))
        .returning();

    return result.length;
}

// ============================================================================
// Query Operations
// ============================================================================

export async function getJob(id: string): Promise<Job | null> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job ?? null;
}

export async function getJobs(filter: JobFilter = {}): Promise<Job[]> {
    const { status, type, limit = 50, offset = 0 } = filter;

    let query = db.select().from(jobs);

    if (status) {
        query = query.where(eq(jobs.status, status)) as typeof query;
    }
    if (type) {
        query = query.where(eq(jobs.type, type)) as typeof query;
    }

    return query
        .orderBy(desc(jobs.priority), asc(jobs.createdAt))
        .limit(limit)
        .offset(offset);
}

export async function getStats(): Promise<JobStats> {
    const allJobs = await db.select().from(jobs);

    const stats: JobStats = {
        pending: 0,
        claimed: 0,
        completed: 0,
        failed: 0,
        total: allJobs.length,
    };

    for (const job of allJobs) {
        if (job.status in stats) {
            stats[job.status as keyof Omit<JobStats, "total">]++;
        }
    }

    return stats;
}

// ============================================================================
// Admin Operations
// ============================================================================

export async function retryJob(jobId: string): Promise<Job | null> {
    const [job] = await db
        .update(jobs)
        .set({
            status: "pending",
            attempts: 0,
            lastError: null,
            lockedBy: null,
            lockedAt: null,
            completedAt: null,
        })
        .where(eq(jobs.id, jobId))
        .returning();

    return job ?? null;
}

export async function deleteJob(jobId: string): Promise<boolean> {
    const result = await db
        .delete(jobs)
        .where(eq(jobs.id, jobId))
        .returning();
    return result.length > 0;
}

export async function purgeCompleted(): Promise<number> {
    const result = await db
        .delete(jobs)
        .where(eq(jobs.status, "completed"))
        .returning();
    return result.length;
}
