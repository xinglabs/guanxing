import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  statSync,
  rmSync,
  symlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "guanxing-deploy-test-"));
  for (const name of ["scripts", "deploy", "compose.server.yaml"])
    cpSync(join(root, name), join(dir, name), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(dir, ...args) {
  return spawnSync(
    "bash",
    ["scripts/start-server.sh", "--init-only", ...args],
    { cwd: dir, encoding: "utf8" },
  );
}
function values(dir) {
  return Object.fromEntries(
    readFileSync(join(dir, ".env.server"), "utf8")
      .split("\n")
      .filter((s) => /^[A-Z_]+=/.test(s))
      .map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]),
  );
}

test("first start creates private random secrets; repeated start preserves them", (t) => {
  const dir = fixture(t);
  const first = run(dir);
  assert.equal(first.status, 0, first.stderr);
  const config = values(dir);
  assert.match(config.APP_SECRET, /^[a-f0-9]{64}$/);
  assert.match(config.SETUP_TOKEN, /^[a-f0-9]{64}$/);
  assert.match(config.POSTGRES_PASSWORD, /^[a-f0-9]{48}$/);
  assert.equal(statSync(join(dir, ".env.server")).mode & 0o777, 0o600);
  for (const key of ["APP_SECRET", "SETUP_TOKEN", "POSTGRES_PASSWORD"])
    assert.ok(!first.stdout.includes(config[key]));
  const before = readFileSync(join(dir, ".env.server"), "utf8");
  assert.equal(run(dir).status, 0);
  assert.equal(readFileSync(join(dir, ".env.server"), "utf8"), before);
});

test("domain and image updates preserve all credentials and keep tunnel origins", (t) => {
  const dir = fixture(t);
  assert.equal(run(dir).status, 0);
  const before = values(dir);
  const result = run(
    dir,
    "--domain",
    "guanxing.example.com",
    "--image",
    "ghcr.io/xinglabs/guanxing:sha-abc123",
  );
  assert.equal(result.status, 0, result.stderr);
  const after = values(dir);
  for (const key of ["APP_SECRET", "SETUP_TOKEN", "POSTGRES_PASSWORD"])
    assert.equal(after[key], before[key]);
  assert.equal(
    after.APP_ORIGIN,
    "https://guanxing.example.com,http://127.0.0.1:3080,http://localhost:3080",
  );
  assert.equal(after.APP_IMAGE, "ghcr.io/xinglabs/guanxing:sha-abc123");
});

test("invalid domain is rejected before writing configuration", (t) => {
  for (const domain of [
    "http://example.com",
    "127.0.0.1",
    "example.com:80",
    "example.com/path",
    "*.example.com",
    "a..example.com",
    "-bad.example.com",
    "example.com { respond hacked }",
  ]) {
    const dir = fixture(t);
    assert.notEqual(run(dir, "--domain", domain).status, 0);
    assert.equal(existsSync(join(dir, ".env.server")), false);
  }
});

test("configuration is parsed as data and never executed", (t) => {
  const dir = fixture(t);
  assert.equal(run(dir).status, 0);
  const file = join(dir, ".env.server");
  const original = readFileSync(file, "utf8");
  writeFileSync(
    file,
    original.replace(/^APP_IMAGE=.*$/m, "APP_IMAGE=$(touch INJECTED)"),
  );
  assert.notEqual(run(dir).status, 0);
  assert.equal(existsSync(join(dir, "INJECTED")), false);
  writeFileSync(file, original + "APP_IMAGE=other\n");
  assert.notEqual(run(dir).status, 0);
});

test("symlink or publicly readable secret files are refused", (t) => {
  const dir = fixture(t);
  const target = join(dir, "untouched");
  writeFileSync(target, "keep");
  symlinkSync(target, join(dir, ".env.server"));
  assert.notEqual(run(dir).status, 0);
  assert.equal(readFileSync(target, "utf8"), "keep");
  rmSync(join(dir, ".env.server"));
  assert.equal(run(dir).status, 0);
  chmodSync(join(dir, ".env.server"), 0o644);
  assert.notEqual(run(dir).status, 0);
});

test("setup token cannot accidentally print into noninteractive logs", (t) => {
  const dir = fixture(t);
  assert.equal(run(dir).status, 0);
  const result = spawnSync("bash", ["scripts/server-setup-token.sh"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes(values(dir).SETUP_TOKEN));
});

function mockDocker(dir) {
  const bin = join(dir, "mock-bin");
  mkdirSync(bin);
  const file = join(bin, "docker");
  writeFileSync(
    file,
    `#!/usr/bin/env bash
printf "%s\\n" "$*" >> "$GX_TEST_LOG"
case "$*" in
  *pg_dump*) printf fake-dump ;;
  *"images --format json"*) printf "[]" ;;
  "image inspect"*) printf '%s' "\${GX_TEST_ARCH:-linux/amd64}" ;;
  "save --output"*) printf fake-images > "$3" ;;
esac
`,
  );
  chmodSync(file, 0o755);
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GX_TEST_LOG: join(dir, "docker-commands.log"),
  };
}

function offlineBundle(dir) {
  const archive = Buffer.from("test-only image archive");
  writeFileSync(join(dir, "images.tar"), archive);
  writeFileSync(
    join(dir, "images.tar.sha256"),
    `${createHash("sha256").update(archive).digest("hex")}  images.tar\n`,
  );
  writeFileSync(
    join(dir, "offline-manifest.env"),
    `RELEASE_VERSION=v3.0.0\nSOURCE_COMMIT=${"a".repeat(40)}\nSOURCE_IMAGE=ghcr.io/xinglabs/guanxing@sha256:${"b".repeat(64)}\nAPP_IMAGE=guanxing-web:v3.0.0\nPGVECTOR_IMAGE=pgvector/pgvector:pg17\nCADDY_IMAGE=caddy:2-alpine\n`,
  );
}

test("offline installer verifies imports and preserves credentials without registry pulls", (t) => {
  const dir = fixture(t);
  offlineBundle(dir);
  assert.equal(run(dir).status, 0);
  const before = values(dir);
  const env = mockDocker(dir);
  const result = spawnSync("bash", ["scripts/install-offline.sh"], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(env.GX_TEST_LOG, "utf8");
  assert.match(commands, /load --input images.tar/);
  assert.match(commands, /up -d --no-build --pull never/);
  assert.doesNotMatch(commands, /^pull |build app/m);
  assert.equal(values(dir).APP_IMAGE, "guanxing-web:v3.0.0");
  for (const key of ["APP_SECRET", "SETUP_TOKEN", "POSTGRES_PASSWORD"])
    assert.equal(values(dir)[key], before[key]);
});

test("offline installer rejects damaged archive or executable manifest before touching Docker", (t) => {
  for (const bad of ["checksum", "manifest"]) {
    const dir = fixture(t);
    offlineBundle(dir);
    const env = mockDocker(dir);
    if (bad === "checksum") writeFileSync(join(dir, "images.tar"), "changed");
    else {
      const manifest = join(dir, "offline-manifest.env");
      writeFileSync(
        manifest,
        readFileSync(manifest, "utf8").replace(
          "APP_IMAGE=guanxing-web:v3.0.0",
          "APP_IMAGE=$(touch INJECTED)",
        ),
      );
    }
    const result = spawnSync("bash", ["scripts/install-offline.sh"], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(env.GX_TEST_LOG), false);
    assert.equal(existsSync(join(dir, ".env.server")), false);
    assert.equal(existsSync(join(dir, "INJECTED")), false);
  }
});

test("offline installer refuses other architectures before starting app", (t) => {
  const dir = fixture(t);
  offlineBundle(dir);
  const env = { ...mockDocker(dir), GX_TEST_ARCH: "linux/arm64" };
  const result = spawnSync("bash", ["scripts/install-offline.sh"], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected image architecture/);
  assert.equal(existsSync(join(dir, ".env.server")), false);
  assert.doesNotMatch(readFileSync(env.GX_TEST_LOG, "utf8"), /up -d/);
});

test("release packaging includes tracked source and checksums but excludes local secrets", (t) => {
  const dir = fixture(t);
  const git = (...args) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(
    git("add", "scripts", "deploy", "compose.server.yaml").status,
    0,
  );
  assert.equal(
    git(
      "-c",
      "user.name=Deployment Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ).status,
    0,
  );
  assert.equal(git("tag", "v3.0.0").status, 0);
  writeFileSync(join(dir, ".env.server"), "UNTRACKED-SECRET-SENTINEL");
  const env = mockDocker(dir);
  const hashTool = join(dir, "mock-bin", "sha256sum");
  writeFileSync(hashTool, '#!/usr/bin/env bash\nexec shasum -a 256 "$@"\n');
  chmodSync(hashTool, 0o755);
  const result = spawnSync(
    "bash",
    [
      "scripts/package-server-release.sh",
      "v3.0.0",
      `ghcr.io/xinglabs/guanxing@sha256:${"b".repeat(64)}`,
    ],
    {
      cwd: dir,
      env,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const archive = join(
    dir,
    "release-artifacts",
    "guanxing-v3.0.0-linux-amd64.tar.gz",
  );
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /scripts\/install-offline.sh/);
  assert.match(listing.stdout, /images.tar.sha256/);
  assert.match(listing.stdout, /offline-manifest.env/);
  assert.doesNotMatch(
    listing.stdout,
    /\.env.server|docker-commands.log|\.git\//,
  );
  const expected = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  assert.match(
    readFileSync(`${archive}.sha256`, "utf8"),
    new RegExp(`^${expected}  `),
  );
});

test("start defaults to tunnel-only and does not build or print secrets", (t) => {
  const dir = fixture(t);
  const env = mockDocker(dir);
  const result = spawnSync("bash", ["scripts/start-server.sh"], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(env.GX_TEST_LOG, "utf8");
  assert.match(commands, /--profile https stop proxy/);
  assert.match(commands, /up -d --no-build --pull missing/);
  assert.doesNotMatch(commands, /build app/);
  for (const key of ["APP_SECRET", "SETUP_TOKEN", "POSTGRES_PASSWORD"]) {
    assert.ok(!result.stdout.includes(values(dir)[key]));
    assert.ok(!commands.includes(values(dir)[key]));
  }
});

test("backup includes recovery secrets with private permissions", (t) => {
  const dir = fixture(t);
  assert.equal(run(dir).status, 0);
  const env = mockDocker(dir);
  const result = spawnSync("bash", ["scripts/backup-server.sh"], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const folder = join(dir, "backups", readdirSync(join(dir, "backups"))[0]);
  assert.equal(statSync(folder).mode & 0o777, 0o700);
  assert.equal(existsSync(join(folder, "INCOMPLETE")), false);
  assert.equal(
    readFileSync(join(folder, "server.env"), "utf8"),
    readFileSync(join(dir, ".env.server"), "utf8"),
  );
  assert.equal(statSync(join(folder, "server.env")).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes(values(dir).APP_SECRET));
});

test("resolved Compose keeps data private and applies resource/log limits", (t) => {
  const compose = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (compose.status !== 0) {
    t.skip("Docker Compose CLI is unavailable.");
    return;
  }
  const dir = fixture(t);
  assert.equal(run(dir, "--domain", "guanxing.example.com").status, 0);
  const env = { ...process.env };
  for (const key of Object.keys(values(dir))) delete env[key];
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.server",
      "-f",
      "compose.server.yaml",
      "--profile",
      "https",
      "config",
      "--format",
      "json",
    ],
    { cwd: dir, env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const conf = JSON.parse(result.stdout);
  assert.equal(conf.services.app.environment.APP_MODE, "public");
  assert.equal(conf.services.app.ports[0].host_ip, "127.0.0.1");
  assert.equal(conf.services.db.ports, undefined);
  assert.equal(Number(conf.services.app.mem_limit), 536870912);
  assert.equal(Number(conf.services.db.mem_limit), 536870912);
  assert.equal(conf.services.app.logging.options["max-size"], "10m");
  assert.equal(conf.services.proxy.environment.DOMAIN, "guanxing.example.com");
});
