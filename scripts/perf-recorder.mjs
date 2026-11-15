// Vite dev-server plugin: the game POSTs its frame recording to /__perf when run with ?profile
// (src/game/perf.ts) and it is saved under perf/ for `npm run trace`.
import { mkdirSync, writeFileSync } from "node:fs";

export function perfRecorder() {
  return {
    name: "perf-recorder",
    configureServer(server) {
      server.middlewares.use("/__perf", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const name = `perf/recording-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
          mkdirSync("perf", { recursive: true });
          writeFileSync(name, Buffer.concat(chunks));
          res.end(name);
        });
      });
    },
  };
}
