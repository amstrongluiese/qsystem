import "dotenv/config";
import { db } from "./index";
import { countersTable } from "./schema/counters";
import { announcementsTable } from "./schema/announcements";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE TABLE announcements RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE queue RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE counters RESTART IDENTITY CASCADE`);

  await db.insert(countersTable).values([
    {
      name: "Evaluator 1",
      type: "evaluator",
      staffName: "Staff A",
      username: "evaluator1",
      pin: "1234",
      status: "available",
      isActive: true,
    },
    {
      name: "Evaluator 2",
      type: "evaluator",
      staffName: "Staff B",
      username: "evaluator2",
      pin: "1234",
      status: "available",
      isActive: true,
    },
    {
      name: "Tagger 1",
      type: "tagger",
      staffName: "Staff C",
      username: "tagger1",
      pin: "1234",
      status: "available",
      isActive: true,
    },
    {
      name: "Tagger 2",
      type: "tagger",
      staffName: "Staff D",
      username: "tagger2",
      pin: "1234",
      status: "available",
      isActive: true,
    },
    {
      name: "Tagger 3",
      type: "tagger",
      staffName: "Staff E",
      username: "tagger3",
      pin: "1234",
      status: "available",
      isActive: true,
    },
  ]);

  await db.insert(announcementsTable).values([
    {
      message:
        "Welcome to SD Department Enrollment! Please approach the designated counter when your number is called.",
      isActive: true,
    },
    {
      message: "Please have your student ID and prerequisites ready.",
      isActive: true,
    },
  ]);

  console.log("Done. Default accounts:");
  console.log("  Admin      — username: admin  |  password: admin123");
  console.log("  Evaluator1 — username: evaluator1  |  PIN: 1234");
  console.log("  Evaluator2 — username: evaluator2  |  PIN: 1234");
  console.log("  Tagger1    — username: tagger1  |  PIN: 1234");
  console.log("  Tagger2    — username: tagger2  |  PIN: 1234");
  console.log("  Tagger3    — username: tagger3  |  PIN: 1234");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
