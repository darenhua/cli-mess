import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable(
    "jobs",
    {
        id: text("id").primaryKey(),
        type: text("type").notNull(),
        payload: text("payload", { mode: "json" }).notNull(),
        status: text("status", {
            enum: ["pending", "claimed", "completed", "failed"],
        })
            .notNull()
            .default("pending"),
        priority: integer("priority").default(0),
        attempts: integer("attempts").default(0),
        maxAttempts: integer("max_attempts").default(3),
        lastError: text("last_error"),
        lockedBy: text("locked_by"),
        lockedAt: text("locked_at"),
        createdAt: text("created_at")
            .notNull()
            .default(sql`(datetime('now'))`),
        claimedAt: text("claimed_at"),
        completedAt: text("completed_at"),
        idempotencyKey: text("idempotency_key"),
    },
    (table) => [
        index("jobs_status_priority_created_idx").on(
            table.status,
            table.priority,
            table.createdAt
        ),
        index("jobs_type_idempotency_idx").on(
            table.type,
            table.idempotencyKey
        ),
    ]
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
