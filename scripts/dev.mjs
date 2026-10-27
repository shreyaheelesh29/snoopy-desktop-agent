import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({
  configFile: path.join(projectRoot, "vite.config.js"),
  server: { host: "127.0.0.1", port: 5173, strictPort: true }
});

try {
  await vite.listen();
} catch (error) {
  await vite.close().catch(() => {});
  if (error.code === "EADDRINUSE") {
    console.error("Snoopy's dev port 5173 is already in use. Close the other Snoopy window/terminal, then run npm run dev again.");
    process.exit(1);
  }
  throw error;
}

console.log("Snoopy's Vite server is ready at http://127.0.0.1:5173/");
const app = spawn(electronPath, ["."], {
  cwd: projectRoot,
  env: { ...process.env, NODE_ENV: "development" },
  stdio: "inherit",
  windowsHide: false
});

let stopping = false;
async function stop(exitCode = 0, signal) {
  if (stopping) return;
  stopping = true;
  if (app.exitCode === null && !app.killed) app.kill(signal);
  await vite.close();
  process.exitCode = exitCode;
}

app.once("error", (error) => {
  console.error("Could not start Snoopy:", error.message);
  void stop(1);
});
app.once("exit", (code) => { void stop(code ?? 0); });
process.once("SIGINT", () => { void stop(0, "SIGINT"); });
process.once("SIGTERM", () => { void stop(0, "SIGTERM"); });
