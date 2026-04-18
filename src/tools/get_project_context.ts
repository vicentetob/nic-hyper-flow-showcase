import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ExecuteToolOptions } from './types';
import { canonizePath, getCanonizedWorkspaceRootSync, resolveWorkspacePath } from './utils';

const execAsync = promisify(exec);

// ─── Manifests conhecidos ────────────────────────────────────────────────────
const MANIFEST_FILES = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'pubspec.yaml', 'composer.json', 'Gemfile', 'mix.exs', 'CMakeLists.txt', 'Makefile',
];

const ENTRYPOINT_CANDIDATES = [
  'src/index.ts', 'src/main.ts', 'src/app.ts', 'src/extension.ts',
  'src/index.js', 'src/main.js', 'src/app.js',
  'index.ts', 'main.ts', 'app.ts', 'index.js', 'main.js', 'app.js',
  'main.py', 'app.py', 'run.py', '__main__.py',
  'main.go', 'cmd/main.go', 'src/main.rs', 'main.rs',
  'lib/main.dart', 'bin/main.dart',
];

const FRAMEWORK_SIGNALS: Array<{ dep: string; framework: string }> = [
  { dep: 'react', framework: 'React' }, { dep: 'next', framework: 'Next.js' },
  { dep: 'vue', framework: 'Vue' }, { dep: 'nuxt', framework: 'Nuxt' },
  { dep: 'svelte', framework: 'Svelte' }, { dep: 'express', framework: 'Express' },
  { dep: 'fastify', framework: 'Fastify' }, { dep: '@nestjs/core', framework: 'NestJS' },
  { dep: 'koa', framework: 'Koa' }, { dep: 'hono', framework: 'Hono' },
  { dep: 'vite', framework: 'Vite' }, { dep: 'electron', framework: 'Electron' },
  { dep: 'flutter', framework: 'Flutter' }, { dep: 'django', framework: 'Django' },
  { dep: 'flask', framework: 'Flask' }, { dep: 'fastapi', framework: 'FastAPI' },
];

const CONFIG_FILES = [
  'tsconfig.json', 'tsconfig.base.json', '.eslintrc', '.eslintrc.js', '.eslintrc.json',
  'eslint.config.mjs', '.prettierrc', 'prettier.config.js', 'vite.config.ts', 'vite.config.js',
  'webpack.config.js', 'jest.config.ts', 'jest.config.js', 'vitest.config.ts',
  'docker-compose.yml', 'Dockerfile', '.env.example', '.env',
  'firebase.json', 'firestore.rules', 'vercel.json', 'netlify.toml',
];

function safeReadJson(filePath: string): any | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function safeReadText(filePath: string, maxChars = 2000): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw.length > maxChars ? raw.slice(0, maxChars) + '...[truncated]' : raw;
  } catch { return null; }
}

function detectStack(deps: Record<string, string>): string[] {
  const stack: string[] = [];
  const allDeps = Object.keys(deps);
  if (allDeps.some(d => d.includes('typescript') || d === 'ts-node')) { stack.push('TypeScript'); }
  if (allDeps.some(d => d === 'react' || d === 'react-dom')) { stack.push('React'); }
  if (allDeps.some(d => d === 'next')) { stack.push('Next.js'); }
  if (allDeps.some(d => d === 'vue')) { stack.push('Vue'); }
  if (allDeps.some(d => d === 'express')) { stack.push('Express'); }
  if (allDeps.some(d => d === '@nestjs/core')) { stack.push('NestJS'); }
  if (allDeps.some(d => d === 'electron')) { stack.push('Electron'); }
  if (allDeps.some(d => d === 'vite')) { stack.push('Vite'); }
  if (allDeps.some(d => d.startsWith('@firebase') || d === 'firebase')) { stack.push('Firebase'); }
  if (allDeps.some(d => d === 'openai')) { stack.push('OpenAI SDK'); }
  if (allDeps.some(d => d === '@anthropic-ai/sdk')) { stack.push('Anthropic SDK'); }
  if (allDeps.some(d => d === '@google/generative-ai')) { stack.push('Gemini SDK'); }
  if (allDeps.some(d => d === 'prisma' || d === '@prisma/client')) { stack.push('Prisma'); }
  if (allDeps.some(d => d === 'mongoose')) { stack.push('MongoDB/Mongoose'); }
  if (allDeps.some(d => d === 'pg' || d === 'postgres')) { stack.push('PostgreSQL'); }
  return [...new Set(stack)];
}

function detectFrameworks(deps: Record<string, string>): string[] {
  const found: string[] = [];
  for (const { dep, framework } of FRAMEWORK_SIGNALS) {
    if (deps[dep] !== undefined) { found.push(framework); }
  }
  return [...new Set(found)];
}

function getRecentlyModifiedFiles(rootPath: string, limit = 15): string[] {
  const results: Array<{ path: string; mtime: number }> = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '__pycache__', '.dart_tool']);
  const SKIP_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.vsix', '.lock']);

  function walk(dir: string, depth: number) {
    if (depth > 4) { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') { continue; }
      if (SKIP_DIRS.has(entry.name)) { continue; }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath, depth + 1); }
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SKIP_EXTS.has(ext)) { continue; }
        try {
          const stat = fs.statSync(fullPath);
          results.push({ path: fullPath.replace(/\\/g, '/'), mtime: stat.mtimeMs });
        } catch { /* skip */ }
      }
    }
  }

  walk(rootPath, 0);
  results.sort((a, b) => b.mtime - a.mtime);
  const rootNorm = canonizePath(rootPath).replace(/\/+$/, '') + '/';
  return results.slice(0, limit).map(r => r.path.replace(rootNorm, ''));
}

function detectProjectType(rootPath: string, manifests: string[]): string {
  if (manifests.includes('package.json')) {
    const pkg = safeReadJson(path.join(rootPath, 'package.json'));
    if (pkg?.engines?.vscode || pkg?.contributes) { return 'VSCode Extension'; }
    if (pkg?.dependencies?.electron) { return 'Electron App'; }
    if (pkg?.dependencies?.next || pkg?.devDependencies?.next) { return 'Next.js App'; }
    if (pkg?.dependencies?.react || pkg?.devDependencies?.react) { return 'React App'; }
    if (pkg?.dependencies?.express || pkg?.dependencies?.fastify) { return 'Node.js API'; }
    return 'Node.js Project';
  }
  if (manifests.includes('pubspec.yaml')) { return 'Flutter App'; }
  if (manifests.includes('pyproject.toml') || manifests.includes('requirements.txt')) { return 'Python Project'; }
  if (manifests.includes('Cargo.toml')) { return 'Rust Project'; }
  if (manifests.includes('go.mod')) { return 'Go Project'; }
  if (manifests.includes('pom.xml') || manifests.includes('build.gradle')) { return 'Java/Kotlin Project'; }
  return 'Unknown';
}

export async function executeGetProjectContext(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const rootPath = options.workspaceFolder.uri.fsPath;
  const rootNorm = canonizePath(rootPath);

  // ── 1. Manifests ─────────────────────────────────────────────────────────
  const foundManifests: string[] = [];
  for (const mf of MANIFEST_FILES) {
    if (fs.existsSync(path.join(rootPath, mf))) { foundManifests.push(mf); }
  }

  // ── 2. package.json ───────────────────────────────────────────────────────
  let scripts: Record<string, string> = {};
  let runtimeDeps: string[] = [];
  let devDeps: string[] = [];
  let stack: string[] = [];
  let frameworks: string[] = [];
  let projectName = path.basename(rootPath);

  if (foundManifests.includes('package.json')) {
    const pkg = safeReadJson(path.join(rootPath, 'package.json'));
    if (pkg) {
      projectName = pkg.name || projectName;
      scripts = pkg.scripts || {};
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      runtimeDeps = Object.keys(pkg.dependencies || {});
      devDeps = Object.keys(pkg.devDependencies || {});
      stack = detectStack(allDeps);
      frameworks = detectFrameworks(allDeps);
    }
  }

  // ── 3. pubspec.yaml ───────────────────────────────────────────────────────
  let pubspecDeps: string[] = [];
  if (foundManifests.includes('pubspec.yaml')) {
    const raw = safeReadText(path.join(rootPath, 'pubspec.yaml'), 3000);
    if (raw) {
      const matches = raw.match(/^  ([a-z_][a-z0-9_]*):/gm) || [];
      pubspecDeps = matches.map((m: string) => m.trim().replace(':', ''));
      stack.push('Dart', 'Flutter');
    }
  }

  // ── 4. Entrypoints ────────────────────────────────────────────────────────
  const entrypoints: string[] = [];
  for (const ep of ENTRYPOINT_CANDIDATES) {
    if (fs.existsSync(path.join(rootPath, ep))) { entrypoints.push(ep); }
  }

  // ── 5. Config files ───────────────────────────────────────────────────────
  const configFiles: string[] = [];
  for (const cf of CONFIG_FILES) {
    if (fs.existsSync(path.join(rootPath, cf))) { configFiles.push(cf); }
  }

  // ── 6. Arquivos recentes (mtime + git log) ───────────────────────────────
  const recentFiles = getRecentlyModifiedFiles(rootPath, 15);

  // Arquivos mais tocados nos últimos commits (git log)
  let hotFiles: string[] = [];
  try {
    const { stdout } = await execAsync(
      'git log --name-only --pretty=format: -30',
      { cwd: rootPath, timeout: 4000 }
    );
    const freq: Record<string, number> = {};
    for (const line of stdout.split('\n')) {
      const f = line.trim();
      if (!f) { continue; }
      freq[f] = (freq[f] ?? 0) + 1;
    }
    hotFiles = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([f]) => f);
  } catch { /* git não disponível ou não é repo */ }

  // ── 7. Tipo do projeto ────────────────────────────────────────────────────
  const projectType = detectProjectType(rootPath, foundManifests);

  // ── 8. Top-level dirs ─────────────────────────────────────────────────────
  let topLevelDirs: string[] = [];
  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    topLevelDirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => e.name)
      .sort();
  } catch { /* skip */ }

  // ── 9. Arch hints ─────────────────────────────────────────────────────────
  const archHints: string[] = [];
  if (topLevelDirs.includes('src')) { archHints.push('src/ layout'); }
  if (topLevelDirs.includes('functions')) { archHints.push('Firebase Functions'); }
  if (topLevelDirs.includes('remote_control')) { archHints.push('Remote control module'); }
  if (topLevelDirs.includes('landing-page')) { archHints.push('Landing page'); }
  if (configFiles.includes('firebase.json')) { archHints.push('Firebase project'); }
  if (configFiles.includes('docker-compose.yml') || configFiles.includes('Dockerfile')) { archHints.push('Containerized'); }
  if (configFiles.includes('vercel.json')) { archHints.push('Vercel deployment'); }
  if (configFiles.includes('tsconfig.json')) { archHints.push('TypeScript'); }

  // ── 10. Directory Structure (Recursive) ───────────────────────────────────
  let structure = '';
  try {
    const { executeListDirRecursive } = require('./list_dir_recursive');
    const dirResult = await executeListDirRecursive({
      path: '.',
      maxDepth: 3,
      maxFiles: 500,
      includeHidden: false
    }, options);
    structure = dirResult.structure;
  } catch (err) {
    console.error('Error getting directory structure in get_project_context:', err);
  }

  return {
    projectName,
    projectType,
    rootPath: rootNorm,
    stack: [...new Set(stack)],
    frameworks: [...new Set(frameworks)],
    manifests: foundManifests,
    entrypoints,
    configFiles,
    topLevelDirs,
    structure,
    archHints,
    recentlyModified: recentFiles,
    hotFiles,
    dependencies: {
      runtime: runtimeDeps,
      dev: devDeps,
      ...(pubspecDeps.length > 0 ? { pubspec: pubspecDeps } : {})
    },
    scripts,
  };
}

