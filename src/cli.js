// Command line interface for the lyrics splitter.

import fs from 'node:fs';
import path from 'node:path';

import { createLyricsBackup, lrcBackupPath, relativeBackupPath, resolveBackupContext } from './backups.js';
import { writeFileAtomic } from './fileops.js';
import { extOf, loadLyricsFile } from './formats.js';
import { hasChineseMarker } from './language.js';
import { transformLyricsText } from './lrc.js';
import { readLyrics } from './lyrics-source.js';

const DEFAULT_EXTS = ['wav', 'mp3', 'flac', 'lrc'];

const HELP = `用法: node bin/lyrics-split.js <目录> [选项]

把「日文 + 空格 + 中文翻译」混排在同一行的日语歌词，拆成时间戳相同的两行：

  [00:28.70]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田
  变成
  [00:28.70]春空に残る淋しさ そっと心を濡らした
  [00:28.70]春雨后留下的空寂轻轻沾湿心田

支持格式:
  .wav  内嵌 ID3v2 USLT 歌词（保留封面等其它标签和音频字节）
  .mp3  内嵌 ID3v2 USLT 歌词（保留音频字节）
  .flac 内嵌 Vorbis Comment 的 LYRICS / UNSYNCEDLYRICS 等标签
        （保留封面、PADDING 等其它元数据块和音频帧）
  .lrc  同名/独立 LRC 文本文件（保留编码、BOM 与换行风格）

已经拆好的文件会自动跳过，不会重复修改；目录里没有中文翻译特征的
纯日文文件也会跳过，避免误拆。

选项:
  --apply            真正写入文件（默认只预览，不修改）
  --no-backup        不生成 .lyrics-backup 下的 LRC 歌词备份（不推荐）
  --force            对没有中文翻译特征的歌词也强制拆分
  --ext <列表>       只处理这些扩展名，默认 wav,mp3,flac,lrc
  --no-recursive     不进入子目录
  --json <文件>      额外输出 JSON 报告
  --verbose          输出每个文件的特殊边界处理明细
  --quiet            只输出汇总
  -h, --help         显示本帮助
`;

class UsageError extends Error {}

const STATUS_LABELS = {
  'would-change': '待拆分',
  changed: '已拆分',
  'already-ok': '已正确',
  'no-lyrics': '无歌词',
  'skipped-no-translation': '跳过(无中文特征)',
  unsupported: '不支持',
  error: '错误',
};

const NOTE_LABELS = {
  standard: '常规',
  'te-form-shift': 'て形边界修正',
  'no-kana': '无假名边界',
  'ratio-fallback': '短译文回退',
  'latin-start': '英文开头译文',
  'latin-repeat': '英文重复边界',
  'latin-after-punct': '标点后英文译文',
  'jp-only-residual': '日文残留修正',
};

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const options = {
    directory: null,
    apply: false,
    backup: true,
    force: false,
    recursive: true,
    json: null,
    verbose: false,
    quiet: false,
    exts: new Set(DEFAULT_EXTS),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const inlineValue = arg.startsWith('--') && eq > 0 ? arg.slice(eq + 1) : null;

    const takeValue = () => {
      if (inlineValue !== null) return inlineValue;
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${name} 需要一个参数`);
      return value;
    };

    switch (name) {
      case '--apply':
        options.apply = true;
        break;
      case '--dry-run':
        options.apply = false;
        break;
      case '--backup':
        options.backup = true;
        break;
      case '--no-backup':
        options.backup = false;
        break;
      case '--force':
        options.force = true;
        break;
      case '--recursive':
        options.recursive = true;
        break;
      case '--no-recursive':
        options.recursive = false;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--json': {
        const value = takeValue();
        options.json = path.resolve(value);
        break;
      }
      case '--ext': {
        const value = takeValue();
        const list = value
          .split(',')
          .map((item) => item.trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean);
        if (list.length === 0) throw new UsageError('--ext 至少需要一个扩展名');
        options.exts = new Set(list);
        break;
      }
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`未知选项: ${arg}`);
        if (options.directory) throw new UsageError(`多余的参数: ${arg}`);
        options.directory = arg;
    }
  }

  return options;
}

/**
 * @param {string} directory
 * @param {boolean} recursive
 * @param {Set<string>} exts
 * @returns {string[]}
 */
function collectFiles(directory, recursive, exts) {
  const files = [];
  const stack = [directory];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!recursive) continue;
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.lyrics-backup') continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.bak') || entry.name.includes('.tmp-')) continue;
      if (!exts.has(extOf(fullPath).replace(/^\./, ''))) continue;
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * @param {Record<string, number>} notes
 * @returns {string}
 */
function describeNotes(notes) {
  const parts = [];
  for (const [key, count] of Object.entries(notes || {})) {
    if (!count) continue;
    parts.push(`${NOTE_LABELS[key] || key}×${count}`);
  }
  return parts.length > 0 ? `  [${parts.join(', ')}]` : '';
}

/**
 * @param {object} options
 * @param {string} directory
 */
function processDirectory(options, directory) {
  const files = collectFiles(directory, options.recursive, options.exts);
  const results = [];
  const backupContext = options.apply && options.backup ? resolveBackupContext(directory) : null;

  for (const filePath of files) {
    const result = {
      path: filePath,
      relative: path.relative(directory, filePath),
      format: '',
      status: '',
      timedLines: 0,
      linesChanged: 0,
      notes: {},
      backup: null,
      error: null,
    };

    try {
      const loaded = loadLyricsFile(filePath);
      result.format = loaded.format;

      if (!loaded.hasLyrics) {
        result.status = 'no-lyrics';
        results.push(result);
        continue;
      }

      const transform = transformLyricsText(loaded.text);
      result.timedLines = transform.timedLines;
      result.linesChanged = transform.changed;
      result.notes = transform.notes;

      if (transform.changed === 0) {
        result.status = 'already-ok';
        results.push(result);
        continue;
      }

      if (!options.force && !hasChineseMarker(loaded.text)) {
        result.status = 'skipped-no-translation';
        results.push(result);
        continue;
      }

      if (!options.apply) {
        result.status = 'would-change';
        results.push(result);
        continue;
      }

      const output = loaded.build(transform.text);
      loaded.verify(output, transform.text);

      let backupInfo = null;
      if (options.backup) {
        const lrcPath = lrcBackupPath(filePath, backupContext);
        if (fs.existsSync(lrcPath)) {
          const existing = readLyrics(lrcPath, { strictFlacUtf8: false });
          if (existing.text !== loaded.text) {
            throw new Error(
              `existing LRC backup differs from the current lyrics: ${relativeBackupPath(lrcPath, backupContext)}`,
            );
          }
          backupInfo = {
            path: relativeBackupPath(lrcPath, backupContext),
            kind: 'lrc',
            created: false,
          };
        } else {
          const backupPath = createLyricsBackup(filePath, backupContext, {
            text: loaded.text,
            raw: extOf(filePath) === '.lrc',
          });
          const check = readLyrics(backupPath, { strictFlacUtf8: false });
          if (check.text !== loaded.text) {
            throw new Error('backup verification failed: LRC lyrics do not match the original');
          }
          backupInfo = {
            path: relativeBackupPath(backupPath, backupContext),
            kind: 'lrc',
            created: true,
          };
        }
      }

      writeFileAtomic(filePath, output);
      result.backup = backupInfo;
      result.status = 'changed';
    } catch (error) {
      result.status = 'error';
      result.error = error && error.message ? error.message : String(error);
    }

    results.push(result);
  }

  return results;
}

/**
 * @param {object} options
 * @param {string[]} files
 */
function buildSummary(options, files) {
  const summary = {
    mode: options.apply ? 'apply' : 'preview',
    scanned: files.length,
    changed: 0,
    alreadyOk: 0,
    noLyrics: 0,
    skippedNoTranslation: 0,
    errors: 0,
    linesChanged: 0,
    linesTotal: 0,
    backupsCreated: 0,
    backupsReused: 0,
    byExtension: {},
  };

  for (const file of files) {
    const ext = extOf(file.relative).replace(/^\./, '') || '(none)';
    summary.byExtension[ext] = (summary.byExtension[ext] || 0) + 1;
    summary.linesTotal += file.timedLines;
    if (file.backup && file.backup.created) summary.backupsCreated++;
    else if (file.backup) summary.backupsReused++;

    if (file.status === 'changed' || file.status === 'would-change') {
      summary.changed++;
      summary.linesChanged += file.linesChanged;
    } else if (file.status === 'already-ok') {
      summary.alreadyOk++;
    } else if (file.status === 'no-lyrics') {
      summary.noLyrics++;
    } else if (file.status === 'skipped-no-translation') {
      summary.skippedNoTranslation++;
    } else if (file.status === 'error') {
      summary.errors++;
    }
  }

  return summary;
}

function printReport(options, directory, results, summary) {
  if (!options.quiet) {
    const shown = results.filter(
      (file) =>
        file.status !== 'already-ok' ||
        options.verbose,
    );

    for (const file of shown) {
      const label = STATUS_LABELS[file.status] || file.status;
      const noteText = options.verbose ? describeNotes(file.notes) : '';
      const countText =
        file.status === 'changed' || file.status === 'would-change'
          ? `${file.linesChanged} 行 / 共 ${file.timedLines} 行`
          : file.status === 'error'
            ? file.error
            : '';
      console.log(
        `${label.padEnd(10, ' ')}  ${file.relative}  [${file.format}]  ${countText}${noteText}`,
      );
    }

    if (shown.length === 0) {
      console.log('没有需要处理的文件。');
    }
    console.log('');
  }

  const extensionText = Object.entries(summary.byExtension)
    .map(([ext, count]) => `${ext} ${count}`)
    .join(' / ');

  console.log(`目录: ${directory}`);
  console.log(`扫描: ${summary.scanned} 个文件${extensionText ? `（${extensionText}）` : ''}`);
  console.log(
    `${options.apply ? '已拆分' : '待拆分'}: ${summary.changed} 个文件 / ${summary.linesChanged} 行（有效歌词共 ${summary.linesTotal} 行）`,
  );
  console.log(`已正确: ${summary.alreadyOk} 个文件`);
  console.log(`无歌词: ${summary.noLyrics} 个文件`);
  if (summary.skippedNoTranslation > 0) {
    console.log(`跳过(无中文特征): ${summary.skippedNoTranslation} 个文件`);
  }
  console.log(`错误: ${summary.errors} 个文件`);
  if (summary.backupsCreated > 0 || summary.backupsReused > 0) {
    console.log(
      `LRC 备份: 新建 ${summary.backupsCreated} 个 / 复用 ${summary.backupsReused} 个（.lyrics-backup）`,
    );
  }

  if (summary.changed === 0 && summary.errors === 0) {
    console.log('');
    console.log('所有文件的歌词格式都已经正确，无需修改。');
  } else if (!options.apply) {
    console.log('');
    console.log('当前是预览模式，没有写入任何文件。');
    console.log('确认无误后加 --apply 执行拆分（会在 .lyrics-backup 生成 LRC 备份）。');
  } else {
    console.log('');
    console.log('已写入完成；原歌词备份为 .lyrics-backup 下的 LRC 文件（已有备份不会覆盖）。');
  }
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`错误: ${error.message}`);
      console.error('');
      console.error(HELP);
      return 2;
    }
    throw error;
  }

  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (!options.directory) {
    console.error('错误: 缺少目录参数');
    console.error('');
    console.error(HELP);
    return 2;
  }

  const directory = path.resolve(options.directory);
  let stat;
  try {
    stat = fs.statSync(directory);
  } catch {
    console.error(`错误: 目录不存在: ${directory}`);
    return 2;
  }
  if (!stat.isDirectory()) {
    console.error(`错误: 不是目录: ${directory}`);
    return 2;
  }

  const results = processDirectory(options, directory);
  const summary = buildSummary(options, results);

  printReport(options, directory, results, summary);

  if (options.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      directory,
      mode: summary.mode,
      summary,
      files: results.map((file) => ({
        path: file.path,
        relative: file.relative,
        format: file.format,
        status: file.status,
        timedLines: file.timedLines,
        linesChanged: file.linesChanged,
        notes: file.notes,
        backup: file.backup ? file.backup.path : null,
        backupKind: file.backup ? file.backup.kind : null,
        backupCreated: file.backup ? file.backup.created : null,
        error: file.error,
      })),
    };
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
