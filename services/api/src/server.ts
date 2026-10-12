import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { env } from "./env.js";

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: env.PORT });

// Cloud Run sends SIGTERM before scaling an instance down.
process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
