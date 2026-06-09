import "dotenv/config";
import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initSocket } from "./lib/socket";

const port = Number(process.env["PORT"] ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

const server = createServer(app);
initSocket(server);

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});
