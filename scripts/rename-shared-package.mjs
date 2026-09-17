// node scripts/rename-shared-package.mjs <novo-nome> [--web <pasta do ronin-web>] [--dry-run]
//
// Renomeia o pacote de contratos (hoje o `name` de packages/shared/package.json) em todos os
// arquivos de texto versionados (git ls-files) do ronin-api e, com --web, também do ronin-web.
// Se o escopo mudar, troca também `@<escopo-antigo>:registry` por `@<escopo-novo>:registry` (.npmrc
// e docs). Ex.: node scripts/rename-shared-package.mjs @minha-org/ronin-shared --web ../ronin-web
//
// O GitHub Packages exige que o escopo seja o dono do repositório (usuário ou organização), em
// minúsculas. Não mexe em pnpm-lock.yaml: rode `pnpm install` depois, primeiro no ronin-api e
// depois no ronin-web. Revise o diff (textos que citam o nome antigo de propósito) antes de commitar.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/rename-shared-package.mjs';

/** @param {string} message */
const log = (message) => process.stdout.write(`[rename-shared-package] ${message}\n`);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const webIndex = args.indexOf('--web');
const webDir = webIndex >= 0 ? args[webIndex + 1] : undefined;
const target = args.find((a, i) => !a.startsWith('--') && (webIndex < 0 || i !== webIndex + 1));

const NAME_RE = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/;
if (!target || !NAME_RE.test(target)) {
  log(
    'uso: node scripts/rename-shared-package.mjs @<owner>/<nome> [--web ../ronin-web] [--dry-run]',
  );
  log('o nome precisa ser minúsculo e com escopo (ex.: @raphasparda/ronin-shared).');
  process.exit(1);
}
if (webIndex >= 0 && !webDir) {
  log('--web precisa de um caminho (ex.: --web ../ronin-web)');
  process.exit(1);
}

/** @type {{ name: string }} */
const manifest = JSON.parse(readFileSync(join(API_ROOT, 'packages/shared/package.json'), 'utf8'));
const from = manifest.name;
const fromMatch = NAME_RE.exec(from);
if (!fromMatch) {
  log(`nome atual inesperado em packages/shared/package.json: ${from}`);
  process.exit(1);
}
if (from === target) {
  log(`o pacote já se chama ${target}; nada a fazer.`);
  process.exit(0);
}
const fromRegistry = `@${fromMatch[1]}:registry`;
const toRegistry = `@${NAME_RE.exec(target)?.[1]}:registry`;

/** @param {string} root @param {string} label */
function renameIn(root, label) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(
      (f) =>
        f &&
        f !== 'pnpm-lock.yaml' &&
        !(root === API_ROOT && f === SELF) &&
        !/\.(png|jpe?g|gif|ico|webp|woff2?|pdf|exe|tgz)$/i.test(f),
    );
  let changed = 0;
  for (const file of files) {
    const path = join(root, file);
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    let next = text.replaceAll(from, target);
    if (fromRegistry !== toRegistry) next = next.replaceAll(fromRegistry, toRegistry);
    if (next === text) continue;
    changed += 1;
    log(`${dryRun ? '(dry-run) ' : ''}${label}: ${file}`);
    if (!dryRun) writeFileSync(path, next);
  }
  return changed;
}

let total = renameIn(API_ROOT, 'ronin-api');
if (webDir) total += renameIn(resolve(process.cwd(), webDir), 'ronin-web');
log(`${total} arquivo(s) ${dryRun ? 'seriam alterados' : 'alterados'}: ${from} -> ${target}`);
if (!dryRun && total > 0) {
  log(
    'agora rode "pnpm install" no ronin-api e depois no ronin-web, e confira lint/typecheck/test.',
  );
}
