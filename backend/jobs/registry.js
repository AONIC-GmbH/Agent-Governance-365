// Maps a job type -> handler(ctx). New Power Platform jobs (e.g. solution_import)
// register here without touching the runner or routes.
const handlers = new Map();

function register(jobType, handler) {
  if (typeof handler !== "function") throw new Error(`Handler for ${jobType} must be a function`);
  handlers.set(jobType, handler);
}

function getHandler(jobType) {
  return handlers.get(jobType) || null;
}

function listJobTypes() {
  return [...handlers.keys()];
}

module.exports = { register, getHandler, listJobTypes };
