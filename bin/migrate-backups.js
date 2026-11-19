#!/usr/bin/env node
// Migrate legacy `<file>.bak` backups to centralized `.lyrics-backup` LRC
// backups. Preview by default.

import fs from 'node:fs';
import path from 'node:path';

import { migrateBackups } from '../src/migrate.js';

const HELP = `用法: node bin/migrate-backups.js <目录> [选项]

把旧版 <文件>.bak（整文件备份）迁移成：
  <目录>/.lyrics-backup/<原目录层级>/<歌曲>.lrc
并校验 LRC 内容；默认只预览。

选项:
  --apply       真正写入 LRC 备份并删除迁移成功的 .bak
  --keep-bak    只写 LRC 备份，保留 .bak
  --json <文件> 输出 JSON 报告
  --quiet       只输出汇总
  -h, --help    显示帮助
`;

function parseArgs(argv) {
  const options = { directory: null, apply: false, keepBak: false, json: null, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--keep-bak':
        options.keepBak = true;
        break;
      case '--json': {
        const value = argv[++i];
        if (!value) throw new Error('--json 需要一个文件路径');
        options.json = path.resolve(value);
        break;
      }
      case '--quiet':
        options.quiet = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`未知选项: ${arg}`);
        if (options.directory) throw new Error(`多余的参数: ${arg}`);
        options.directory = arg;
    }
  }
  return options;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`错误: ${error.message}`);
    console.error(HELP);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (!options.directory) {
    console.error('错误: 缺少目录参数');
    console.error(HELP);
    return 2;
  }

  let report;
  try {
    report = migrateBackups({
      directory: options.directory,
      apply: options.apply,
      keepBak: options.keepBak,
    });
  } catch (error) {
    console.error(`错误: ${error.message}`);
    return 1;
  }

  const { summary, files } = report;
  const wouldFree = files
    .filter((file) => ['created', 'reused', 'migrated'].includes(file.status))
    .reduce((total, file) => total + file.bytes, 0);

  if (!options.quiet) {
    for (const file of files) {
      if (file.status === 'skipped' || file.status === 'error') {
        console.log(`${file.status === 'error' ? '错误' : '跳过'}  ${file.original}  ${file.error || ''}`);
      } else {
        const action = file.status === 'migrated'
          ? '已迁移并删除 .bak'
          : options.apply
            ? (file.status === 'reused' ? '复用 LRC 备份' : '新建 LRC 备份')
            : (file.status === 'reused' ? '已有 LRC 备份，将删除 .bak' : '将新建 LRC 备份并删除 .bak');
        console.log(`${action}  ${file.original}  ->  ${file.backup}`);
      }
    }
    if (files.length === 0) console.log('没有找到 .bak 文件。');
    console.log('');
  }

  console.log(`目录: ${summary.directory}`);
  console.log(`备份根: ${summary.backupRoot}`);
  console.log(`扫描 .bak: ${summary.scanned} 个`);
  console.log(`LRC 备份: 新建 ${summary.created} 个 / 复用 ${summary.reused} 个 / 跳过 ${summary.skipped} 个 / 错误 ${summary.errors} 个`);
  if (options.apply) {
    console.log(`已删除 .bak: ${summary.deleted} 个，释放 ${formatBytes(summary.bytesFreed)}`);
    if (options.keepBak) console.log('--keep-bak: 已保留 .bak');
  } else {
    console.log(`预览：未写入、未删除。执行后预计释放约 ${formatBytes(wouldFree)}。`);
    console.log('确认无误后加 --apply 执行迁移并删除 .bak。');
  }

  if (options.json) {
    try {
      fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`JSON 报告: ${options.json}`);
    } catch (error) {
      console.error(`错误: 无法写入 JSON 报告: ${error.message}`);
      return 1;
    }
  }

  return summary.errors > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
