import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const countersTable = pgTable("counters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // evaluator | tagger | hybrid | queue_assistant
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  specialization: text("specialization"),
  staffName: text("staff_name"),
  username: text("username"),
  pin: text("pin").notNull(),
  status: text("status").notNull().default("available"), // available | busy | break | offline
  isActive: boolean("is_active").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(false),
  currentQueueCount: integer("current_queue_count").notNull().default(0),
  currentStudentId: integer("current_student_id"),
  currentStudentName: text("current_student_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCounterSchema = createInsertSchema(countersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCounter = z.infer<typeof insertCounterSchema>;
export type Counter = typeof countersTable.$inferSelect;
