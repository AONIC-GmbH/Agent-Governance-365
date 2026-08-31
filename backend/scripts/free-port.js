const { execSync } = require("child_process");

// Only relevant for local Windows dev, where a previous run may still hold the
// port. On other platforms (e.g. Azure App Service / Linux) these commands don't
// exist and the platform manages the port, so skip to avoid breaking startup.
if (process.platform !== "win32") {
  process.exit(0);
}

const PORT = process.env.PORT || 7071;

try {
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: "utf8" });
  const pids = new Set();
  for (const line of out.split("\n")) {
    if (!line.includes("LISTENING")) continue;
    const pid = line.trim().split(/\s+/).pop();
    if (pid && pid !== "0") pids.add(pid);
  }
  for (const pid of pids) {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    console.log(`Freed port ${PORT} (stopped PID ${pid})`);
  }
} catch {
  // Port already free
}
