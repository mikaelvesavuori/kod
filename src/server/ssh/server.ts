import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import type { Server as NetServer } from 'node:net';

import ssh2 from 'ssh2';
import type {
  AuthContext,
  ParsedKey,
  PublicKeyAuthContext,
  ServerChannel
} from 'ssh2';

import type { Repo, ServerConfig } from '../../shared/types.js';
import type { Database } from '../db/index.js';
import type { RepoManager } from '../git/RepoManager.js';

import { parsePublicKey } from './keys.js';

const { Server: Ssh2Server } = ssh2;

interface SshIdentity {
  username: string;
  keyId?: string;
  anonymous?: boolean;
}

interface SshServerOptions {
  db: Database;
  repoManager: RepoManager;
  config: ServerConfig;
}

export async function startSshServer(
  options: SshServerOptions
): Promise<NetServer> {
  const hostKey = ensureHostKey(options.config.sshHostKeyPath);
  const server = new Ssh2Server({ hostKeys: [hostKey] }, (client) => {
    let identity: SshIdentity | undefined;

    client
      .on('authentication', (ctx) => {
        void authenticate(ctx, options.db, options.config).then((result) => {
          if (!result) {
            ctx.reject(authMethods(options.config));
            return;
          }

          identity = result;
          ctx.accept();
        });
      })
      .on('error', () => {})
      .on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();

          session.on('pty', (acceptPty) => {
            acceptPty();
          });

          session.on('shell', (acceptShell) => {
            const stream = acceptShell();
            void showRepoDiscovery(stream, identity, options);
          });

          session.on('exec', (acceptExec, _rejectExec, info) => {
            const stream = acceptExec();
            void handleSshCommand(
              stream,
              info.command,
              identity,
              options
            ).catch((err) => {
              writeAndExit(
                stream,
                `${err instanceof Error ? err.message : 'SSH command failed'}\n`,
                1,
                true
              );
            });
          });
        });
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.config.sshPort, options.config.sshHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

async function authenticate(
  ctx: AuthContext,
  db: Database,
  config: ServerConfig
): Promise<SshIdentity | undefined> {
  if (ctx.method === 'none') {
    return config.sshAnonymousRead && isAnonymousUsername(ctx.username)
      ? { username: 'anonymous', anonymous: true }
      : undefined;
  }

  if (ctx.method !== 'publickey') {
    return undefined;
  }

  const keyData = ctx.key.data.toString('base64');
  const dbKey = await db.findSshKeyByData(ctx.key.algo, keyData);
  if (dbKey) {
    const parsed = parsePublicKey(dbKey.publicKey);
    if (!parsed || !verifySignature(ctx, parsed.parsedKey)) {
      return undefined;
    }

    if (ctx.signature) {
      await db.touchSshKey(dbKey.id);
    }
    return { username: dbKey.username, keyId: dbKey.id };
  }

  const collaborator = await findLegacyCollaboratorKey(db, ctx);
  if (collaborator) {
    return { username: collaborator };
  }

  return undefined;
}

function verifySignature(
  ctx: PublicKeyAuthContext,
  parsedKey: ParsedKey
): boolean {
  if (!ctx.signature || !ctx.blob) return true;
  return parsedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true;
}

async function findLegacyCollaboratorKey(
  db: Database,
  ctx: PublicKeyAuthContext
): Promise<string | undefined> {
  const collaborators = await db.listCollaborators();
  for (const collaborator of collaborators) {
    if (!collaborator.publicKey) continue;
    const parsed = parsePublicKey(collaborator.publicKey);
    if (
      parsed &&
      parsed.keyType === ctx.key.algo &&
      parsed.keyData === ctx.key.data.toString('base64') &&
      verifySignature(ctx, parsed.parsedKey)
    ) {
      return collaborator.username;
    }
  }

  return undefined;
}

async function handleSshCommand(
  stream: ServerChannel,
  command: string,
  identity: SshIdentity | undefined,
  options: SshServerOptions
): Promise<void> {
  const args = splitCommand(command);
  const executable = args[0];

  if (!executable || ['help', 'repos', 'list', 'ls'].includes(executable)) {
    await showRepoDiscovery(stream, identity, options);
    return;
  }

  if (executable === 'info') {
    await showRepoInfo(stream, args[1], identity, options);
    return;
  }

  if (executable !== 'git-upload-pack' && executable !== 'git-receive-pack') {
    writeAndExit(stream, `Unsupported SSH command: ${command}\n`, 1, true);
    return;
  }

  const repoName = repoNameFromPath(args[1]);
  if (!repoName) {
    writeAndExit(stream, 'Repository path is required\n', 1, true);
    return;
  }

  const repo = await options.db.getRepo(repoName);
  if (!repo) {
    writeAndExit(stream, 'Repository not found\n', 1, true);
    return;
  }

  const write = executable === 'git-receive-pack';
  if (!(await canAccessRepo(identity, repo, write, options))) {
    writeAndExit(stream, 'Repository access denied\n', 1, true);
    return;
  }

  const owner =
    identity && !identity.anonymous
      ? await isOwner(identity.username, repo, options.db)
      : false;

  runGitService(stream, executable, repo, identity, owner);
}

function runGitService(
  stream: ServerChannel,
  service: 'git-upload-pack' | 'git-receive-pack',
  repo: Repo,
  identity: SshIdentity | undefined,
  owner: boolean
): void {
  const gitSubcommand =
    service === 'git-upload-pack' ? 'upload-pack' : 'receive-pack';
  const proc = spawn('git', [gitSubcommand, repo.path], {
    shell: false,
    env: {
      ...process.env,
      KOD_IS_ADMIN: 'false',
      KOD_IS_OWNER: owner ? 'true' : 'false',
      KOD_TOKEN_ID: identity?.keyId ?? '',
      KOD_USERNAME: identity?.username ?? ''
    }
  });

  stream.pipe(proc.stdin);
  proc.stdout.pipe(stream, { end: false });
  proc.stderr.pipe(stream.stderr, { end: false });

  proc.on('close', (code) => {
    stream.exit(code ?? 0);
    stream.end();
  });

  proc.on('error', (err) => {
    writeAndExit(stream, `${err.message}\n`, 1, true);
  });
}

async function showRepoDiscovery(
  stream: ServerChannel,
  identity: SshIdentity | undefined,
  options: SshServerOptions
): Promise<void> {
  const repos = await visibleRepos(identity, options);
  const lines = ['Kod SSH', '', 'Repositories:'];

  if (repos.length === 0) {
    lines.push('  (none)');
  } else {
    for (const repo of repos) {
      lines.push(`  ${repo.name}`);
    }
  }

  lines.push(
    '',
    'Commands:',
    '  ssh kod@host repos',
    '  ssh kod@host info <repo>',
    '  git clone ssh://kod@host/<repo>.git',
    ''
  );

  writeAndExit(stream, `${lines.join('\n')}\n`);
}

async function showRepoInfo(
  stream: ServerChannel,
  name: string | undefined,
  identity: SshIdentity | undefined,
  options: SshServerOptions
): Promise<void> {
  const repoName = repoNameFromPath(name);
  if (!repoName) {
    writeAndExit(stream, 'Usage: info <repo>\n', 1, true);
    return;
  }

  const repo = await options.db.getRepo(repoName);
  if (!repo) {
    writeAndExit(stream, 'Repository not found\n', 1, true);
    return;
  }

  if (!(await canAccessRepo(identity, repo, false, options))) {
    writeAndExit(stream, 'Repository access denied\n', 1, true);
    return;
  }

  const branches = await options.repoManager.getBranches(repo.name);
  const defaultBranch = await options.repoManager.getDefaultBranch(repo.name);

  const lines = [
    `Repository: ${repo.name}`,
    `Default branch: ${defaultBranch || '(none)'}`,
    'Branches:'
  ];

  if (branches.length === 0) {
    lines.push('  (none)');
  } else {
    for (const branch of branches) {
      lines.push(`  ${branch}${branch === defaultBranch ? ' *' : ''}`);
    }
  }

  writeAndExit(stream, `${lines.join('\n')}\n`);
}

async function visibleRepos(
  identity: SshIdentity | undefined,
  options: SshServerOptions
): Promise<Repo[]> {
  const repos = await options.db.listRepos();
  const visible: Repo[] = [];

  for (const repo of repos) {
    if (await canAccessRepo(identity, repo, false, options)) {
      visible.push(repo);
    }
  }

  return visible;
}

async function canAccessRepo(
  identity: SshIdentity | undefined,
  repo: Repo,
  write: boolean,
  options: SshServerOptions
): Promise<boolean> {
  if (!identity) return false;
  if (identity.anonymous) {
    return options.config.sshAnonymousRead && !write;
  }

  if (await isOwner(identity.username, repo, options.db)) {
    return true;
  }

  const collaborators = await options.db.getRepoCollaborators(repo.name);
  if (!collaborators?.collaborators.includes(identity.username)) {
    return false;
  }

  return !write || !identity.anonymous;
}

async function isOwner(
  username: string,
  repo: Repo,
  db: Database
): Promise<boolean> {
  const token = await db.getApiTokenById(repo.ownerTokenId);
  return token?.username === username;
}

function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function repoNameFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  let name = path.trim().replace(/^\/+/u, '');
  if (name.startsWith('repos/')) {
    name = name.slice('repos/'.length);
  }
  name = name.replace(/\.git$/u, '');

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return undefined;
  }

  return name;
}

function writeAndExit(
  stream: ServerChannel,
  message: string,
  code = 0,
  stderr = false
): void {
  if (stderr) {
    stream.stderr.write(message);
  } else {
    stream.write(message);
  }
  stream.exit(code);
  stream.end();
}

function authMethods(config: ServerConfig): ('publickey' | 'none')[] {
  return config.sshAnonymousRead ? ['publickey', 'none'] : ['publickey'];
}

function isAnonymousUsername(username: string): boolean {
  return username === 'anonymous' || username === 'anon';
}

function ensureHostKey(path: string): Buffer {
  if (existsSync(path)) {
    return readFileSync(path);
  }

  mkdirSync(dirname(path), { recursive: true });
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    }
  });

  writeFileSync(path, privateKey, { mode: 0o600 });
  chmodSync(path, 0o600);
  return Buffer.from(privateKey);
}
