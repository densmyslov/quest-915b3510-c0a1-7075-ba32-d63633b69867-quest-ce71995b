import fs from 'node:fs';
import path from 'node:path';
import questJson from '../src/data/quest.json';
import { compileQuestFromQuestJson } from '../src/runtime-core/compileQuest';

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function main() {
  const questId = readArg('questId') ?? (questJson as any)?.quest?.id ?? 'quest';
  const questVersion = readArg('questVersion') ?? (questJson as any)?.quest?.version ?? 'v1';
  const publishedAt = readArg('publishedAt') ?? '1970-01-01T00:00:00.000Z';
  const outDir = path.join(process.cwd(), 'public', 'compiled');
  const outPath = path.join(outDir, `${questId}@${questVersion}.json`);

  const compiled = compileQuestFromQuestJson(questJson as any, {
    questId,
    questVersion,
    schemaVersion: '1.0.0',
    publishedAt,
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(compiled, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
}

main();
