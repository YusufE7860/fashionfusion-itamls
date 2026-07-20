import { Injectable, Logger } from '@nestjs/common';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';

const exec = promisify(execCb);

@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);
  private readonly repoDir = process.env.REPO_DIR ?? '/repo';
  private readonly hostRepo = process.env.HOST_REPO_PATH ?? '/opt/itamls';

  /** Compare local HEAD against origin — updateAvailable when they differ. */
  async status() {
    const inRepo = fs.existsSync(`${this.repoDir}/.git`);
    if (!inRepo) {
      return {
        available: false, ready: false,
        message: 'Update service not available — repo directory not mounted. Rebuild the API with the updater setup.',
      };
    }

    // Fetch without failing hard if we can't reach GitHub.
    // - Hard timeout of 20s so we never hang the API.
    // - Disable credential prompts so we fail loudly on private-repo auth issues.
    try {
      await this.gitNoPrompt('fetch --all --prune', 20_000);
    } catch (e: any) {
      const short = String(e.message ?? e).split('\n').slice(0, 3).join(' ');
      return {
        ready: true, available: false,
        message: `Could not reach the git remote: ${short}. If the repo is private, set the origin URL with a token: \`git remote set-url origin https://USER:TOKEN@github.com/...\``,
        currentCommit: (await this.git('rev-parse --short HEAD')).stdout.trim(),
      };
    }

    const branch = (await this.git('rev-parse --abbrev-ref HEAD')).stdout.trim();
    const local  = (await this.git('rev-parse HEAD')).stdout.trim();
    const remote = (await this.git(`rev-parse origin/${branch}`)).stdout.trim();
    const currentCommit = local.slice(0, 8);
    const remoteCommit  = remote.slice(0, 8);
    const available = local !== remote;

    let pending: string[] = [];
    if (available) {
      const { stdout } = await this.git(`log --oneline HEAD..origin/${branch}`);
      pending = stdout.trim().split('\n').filter(Boolean).slice(0, 30);
    }

    const currentTitle = (await this.git('log -1 --pretty=%s')).stdout.trim();
    const currentDate  = (await this.git('log -1 --pretty=%ci')).stdout.trim();

    return {
      ready: true,
      available,
      branch,
      currentCommit,
      currentTitle,
      currentDate,
      remoteCommit,
      pending,
      updating: await this.isUpdating(),
    };
  }

  /** Spawn a detached updater container. Returns immediately. */
  async install() {
    if (await this.isUpdating()) {
      return { started: false, message: 'An update is already running.' };
    }
    // Wipe the previous log so the UI shows only this run's output
    try { fs.writeFileSync(`${this.repoDir}/.update.log`, ''); } catch {}

    // We spawn a short-lived docker container that has git + docker CLI and
    // the host repo bind-mounted. It runs updater.sh which lives in the repo.
    // Using --name lets us detect "in progress" state via docker ps.
    const cmd =
      `docker run -d --rm --name itamls_updater ` +
      `-v /var/run/docker.sock:/var/run/docker.sock ` +
      `-v ${this.hostRepo}:/repo ` +
      `-w /repo ` +
      `docker:cli sh -c "apk add --no-cache git bash && bash updater.sh"`;

    try {
      const { stdout } = await exec(cmd);
      this.logger.log(`Updater container: ${stdout.trim()}`);
      return { started: true, containerId: stdout.trim() };
    } catch (e: any) {
      throw new Error(`Failed to start updater: ${e.stderr ?? e.message}`);
    }
  }

  async isUpdating() {
    try {
      const { stdout } = await exec('docker ps --filter name=itamls_updater --format "{{.Names}}"');
      return stdout.trim().length > 0;
    } catch { return false; }
  }

  /** Tail the last N lines of the updater's log so the UI can stream progress. */
  async log(lines = 200) {
    const path = `${this.repoDir}/.update.log`;
    try {
      const content = fs.readFileSync(path, 'utf-8');
      const all = content.split('\n');
      return { lines: all.slice(-lines).join('\n') };
    } catch {
      return { lines: '' };
    }
  }

  private git(args: string) {
    return exec(`git -C ${this.repoDir} ${args}`, { timeout: 20_000 });
  }

  /** git command that will never wait for an interactive credential prompt. */
  private gitNoPrompt(args: string, timeoutMs = 20_000) {
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
    };
    return exec(`git -C ${this.repoDir} ${args}`, { env, timeout: timeoutMs });
  }
}
