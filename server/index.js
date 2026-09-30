import { createApp } from "./app.js";
const app = createApp();
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "0.0.0.0",
  () =>
    console.log(
      `RM API พร้อมใช้งาน: http://localhost:${process.env.PORT || 3001}`,
    ),
);
function stop() {
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
