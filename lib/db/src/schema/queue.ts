import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const queueTable = pgTable(
  "queue",
  {
    id: serial("id").primaryKey(),
    queueNumber: text("queue_number").notNull(),
    fullName: text("full_name").notNull(),
    studentNumber: text("student_number"),
    category: text("category").notNull(), // regular | wep | transferee | old
    yearLevel: text("year_level"),        // 1st | 2nd | 3rd | 4th
    regularity: text("regularity"),       // regular | irregular
    isWep: boolean("is_wep").default(false),
    isReturnee: boolean("is_returnee").default(false),
    status: text("status").notNull().default("waiting"), // waiting | called | in_progress | completed | cancelled
    workflow: text("workflow").notNull(),  // evaluation | direct_tagging
    assignedCounterId: integer("assigned_counter_id"),
    evaluatedBy: integer("evaluated_by"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    taggerCounterId: integer("tagger_counter_id"),
    taggedBy: integer("tagged_by"),
    taggedAt: timestamp("tagged_at", { withTimezone: true }),
    calledAt: timestamp("called_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByAssistantId: integer("created_by_assistant_id"),
    createdByAssistantAt: timestamp("created_by_assistant_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    taggedByIdx: index("idx_queue_tagged_by").on(table.taggedBy),
    evaluatedByIdx: index("idx_queue_evaluated_by").on(table.evaluatedBy),
    assistantCreatedByIdx: index("idx_queue_created_by_assistant_id").on(table.createdByAssistantId),
    taggedAtIdx: index("idx_queue_tagged_at").on(table.taggedAt),
    evaluatedAtIdx: index("idx_queue_evaluated_at").on(table.evaluatedAt),
  }),
);

export const insertQueueSchema = createInsertSchema(queueTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQueue = z.infer<typeof insertQueueSchema>;
export type QueueEntry = typeof queueTable.$inferSelect;
