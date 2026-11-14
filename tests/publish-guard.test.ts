import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/publish-public.sh', import.meta.url))
const identity = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgsign=false',
]
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', [...identity, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function writeFiles(path: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const target = join(path, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

function initRepo(path: string, files: Record<string, string>) {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-b', 'main')
  writeFiles(path, files)
  git(path, 'add', '.')
  git(path, 'commit', '-m', 'init')
}

/**
 * A development repo whose `public` remote is another local repository.
 *
 * These tests do not exercise the push itself: this sandbox's git rejects local
 * pushes with "bad pack". The guard runs before any network operation and the
 * fast-forward check only needs a fetch, which is what is covered here.
 */
function setup(files: Record<string, string> = { 'README.md': '# dev\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'whelkmail-publish-'))
  dirs.push(root)
  const work = join(root, 'dev')
  const remote = join(root, 'public')
  initRepo(remote, { 'README.md': '# public\n' })
  initRepo(work, files)
  mkdirSync(join(work, 'scripts'), { recursive: true })
  copyFileSync(script, join(work, 'scripts', 'publish-public.sh'))
  writeFiles(work, { '.gitignore': 'scripts/publish-public.sh.orig\n' })
  git(work, 'add', '.')
  git(work, 'commit', '-m', 'script')
  git(work, 'remote', 'add', 'public', remote)
  return { work, remote }
}

function publish(work: string) {
  return spawnSync('sh', ['scripts/publish-public.sh'], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

/** Stage and commit, which is what the guard inspects (the branch tree). */
function commitFiles(work: string, files: Record<string, string>) {
  writeFiles(work, files)
  git(work, 'add', '-f', ...Object.keys(files))
  git(work, 'commit', '-m', 'add files')
}

describe('publish guard', () => {
  it('refuses a tracked .env', () => {
    const { work } = setup()
    commitFiles(work, { '.env': 'APP_PASSWORD=secret\n' })

    const result = publish(work)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('private deployment')
    expect(result.stderr).toContain('.env')
  })

  it('refuses environment variants and the worker config', () => {
    const { work } = setup()
    commitFiles(work, {
      '.dev.vars.production': 'TOKEN=1\n',
      'worker/wrangler.toml': 'name = "private"\n',
    })

    const result = publish(work)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('.dev.vars.production')
    expect(result.stderr).toContain('worker/wrangler.toml')
  })

  it('lets the .example templates through the guard', () => {
    const { work } = setup({
      'README.md': '# dev\n',
      '.env.example': 'APP_PASSWORD=\n',
      'wrangler.toml.example': 'name = "template"\n',
      'worker/wrangler.toml.example': 'name = "template"\n',
    })

    const result = publish(work)

    // It stops later (the two histories are unrelated here), never on the guard.
    expect(result.stderr).not.toContain('private deployment')
  })

  it('refuses when the remote has commits missing locally', () => {
    const { work, remote } = setup()
    writeFiles(remote, { 'pr.txt': 'merged\n' })
    git(remote, 'add', 'pr.txt')
    git(remote, 'commit', '-m', 'pr merged on public')

    const result = publish(work)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('git merge public/main')
  })
})
