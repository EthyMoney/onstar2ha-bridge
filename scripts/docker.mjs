// Build and publish the Docker image, tagged with the package.json version and "latest".
//
//   npm run docker:build    build ultimate360/onstar2ha-bridge:<version> and :latest
//   npm run docker:push     push both tags to Docker Hub (run `docker login` first)
//   npm run docker:deploy   build, then push
//
// Append `-- --dry-run` to print the docker commands without running them.
// Set DOCKER_IMAGE to publish under a different repository name.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
const image = process.env.DOCKER_IMAGE || "ultimate360/onstar2ha-bridge";
const tags = [`${image}:${version}`, `${image}:latest`];
const dryRun = process.argv.includes("--dry-run");
const command = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

function docker(...args) {
  console.log(`$ docker ${args.join(" ")}`);
  if (dryRun) return;
  const { status, error } = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (error) {
    console.error(`Failed to run docker: ${error.message}`);
    process.exit(1);
  }
  if (status !== 0) process.exit(status ?? 1);
}

const steps = {
  build: () => docker("build", ...tags.flatMap((tag) => ["-t", tag]), "."),
  push: () => tags.forEach((tag) => docker("push", tag)),
  deploy: () => {
    steps.build();
    steps.push();
  },
};

if (!steps[command]) {
  console.error(`Usage: node scripts/docker.mjs <${Object.keys(steps).join("|")}> [--dry-run]`);
  process.exit(1);
}
steps[command]();
