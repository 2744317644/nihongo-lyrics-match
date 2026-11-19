window.__ModuleLoader__.load({
  id: 'dsh-nihongo-lyrics-match',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'lyricsReview';
    const API = '/_dsh/lyrics-review';
    const DIRECTORY_KEY = 'dsh.lyrics-review.directory';
    const FILTERS = ['flagged', 'all'];
    const LIMITS = [50, 100, 300, 1000];

    const ZH = {
      sectionLabel: '歌词匹配',
      title: '日语歌词匹配',
      description: '扫描已拆分的歌词目录，逐行查看可疑拆分与标记，并从集中保存的 LRC 备份还原单个文件。',
      directoryLabel: '歌词目录',
      directoryPlaceholder: '绝对路径，例如 D:\\Music\\JPOP',
      pick: '选择目录…',
      scan: '扫描',
      rescan: '重新扫描',
      scanning: '正在扫描…',
      scanHint: '扫描只读：对比当前歌词与该文件的 LRC 备份（.lyrics-backup）或旧版 .bak，不写入任何文件。',
      needDirectory: '请先填写一个歌词目录。',
      pickFailed: '选择目录失败：{message}',
      scanFailed: '扫描失败：{message}',
      idleTitle: '复核已拆分的歌词',
      idleBody: '输入已经转换过的目录并扫描。结果按文件汇总，并列出需要人工确认的拆分行。',
      emptyDirectory: '该目录没有可处理的 WAV、MP3、FLAC 或 LRC 文件。',
      summaryTitle: '汇总',
      filesScanned: '文件',
      withBackup: '有备份',
      pairs: '拆分对',
      flaggedPairs: '可疑对',
      titleLines: '标题行',
      converted: '已拆分',
      manualEdits: '手工修改',
      alreadyOk: '已正确',
      noLyrics: '无歌词',
      needsConversion: '待拆分',
      noBackup: '无备份',
      errors: '错误',
      filesCount: '共 {count} 个',
      filesOmittedHint: '另有 {count} 个文件未列出；请缩小目录或只查看单个文件。',
      filterLabel: '行筛选',
      fileRowLabel: '文件 {path}，状态 {status}，{pairs} 对，{flagged} 可疑',
      reasonsTitle: '拆分原因',
      flagsTitle: '标记',
      filesTitle: '需要复核的文件',
      filesTitleAll: '全部文件',
      fileColumn: '文件',
      formatColumn: '格式',
      statusColumn: '状态',
      pairsColumn: '对数',
      flaggedColumn: '可疑',
      noFilesFlagged: '没有需要复核的文件。',
      noBackupShort: '无备份',
      noBackupHint: '有 {count} 个文件没有 LRC 备份或旧版 .bak，无法对比或还原。',
      backupSummary: '备份：LRC {lrc} · 旧版 .bak {legacy} · 无备份 {none}；位置：{root}',
      linesTitleAll: '可疑拆分行',
      linesTitleAllLines: '全部拆分行',
      linesTitleFile: '「{file}」的拆分行',
      filterFlagged: '可疑',
      filterAll: '全部',
      limitLabel: '上限',
      backToAll: '返回整目录',
      showing: '显示 {shown} / 共 {matched}',
      truncatedHint: '结果已截断：可以选中单个文件或切换筛选来收窄。',
      loadingLines: '正在读取该文件…',
      fileFailed: '读取该文件失败：{message}',
      emptyFlaggedLines: '当前视图没有可疑行。',
      emptyAllLines: '当前视图没有拆分对。',
      selectFileHint: '选择上方的一个文件，查看逐行结果并还原。',
      revert: '还原歌词',
      revertTitle: '用备份还原这个文件？',
      revertBody: '当前歌词会恢复为 LRC 备份中的原始歌词；音频与封面字节不变，备份保留。还原后复核会把这个文件标为未拆分 / 手工修改。',
      revertBackup: 'LRC 备份：{backup}',
      revertBackupLegacy: '旧版 .bak：{backup}',
      revertConfirm: '还原',
      revertSkipped: '这个文件没有 LRC 备份或旧版 .bak，无法还原。',
      cancel: '取消',
      reverting: '正在还原…',
      reverted: '已还原 {file}，LRC 备份仍保留。',
      revertPartial: '还原完成，但有 {count} 个错误：{message}',
      revertFailed: '还原失败：{message}',
      statusConverted: '已拆分',
      statusAlreadyOk: '已正确',
      statusManualEdit: '手工修改',
      statusNoLyrics: '无歌词',
      statusWouldChange: '待拆分',
      statusError: '错误',
      statusUnknown: '未知',
    };

    const EN = {
      sectionLabel: 'Lyrics match',
      title: 'Nihongo Lyrics Match',
      description: 'Scan a converted lyrics directory, inspect every flagged split line, and restore one file from its centralized LRC backup.',
      directoryLabel: 'Lyrics directory',
      directoryPlaceholder: 'Absolute path, e.g. D:\\Music\\JPOP',
      pick: 'Choose folder…',
      scan: 'Scan',
      rescan: 'Rescan',
      scanning: 'Scanning…',
      scanHint: 'The scan is read-only: it compares the current lyrics with the file’s LRC backup under .lyrics-backup (or a legacy .bak) and writes nothing.',
      needDirectory: 'Enter a lyrics directory first.',
      pickFailed: 'Could not choose a folder: {message}',
      scanFailed: 'Scan failed: {message}',
      idleTitle: 'Review converted lyrics',
      idleBody: 'Enter a directory that was already converted and scan it. Results are summarized per file with the split lines that need a human look.',
      emptyDirectory: 'No WAV, MP3, FLAC, or LRC file was found in this directory.',
      summaryTitle: 'Summary',
      filesScanned: 'Files',
      withBackup: 'With backup',
      pairs: 'Pairs',
      flaggedPairs: 'Flagged',
      titleLines: 'Title lines',
      converted: 'Converted',
      manualEdits: 'Manual edits',
      alreadyOk: 'Already ok',
      noLyrics: 'No lyrics',
      needsConversion: 'Needs conversion',
      noBackup: 'No backup',
      errors: 'Errors',
      filesCount: '{count} file(s)',
      filesOmittedHint: '{count} more file(s) are not listed; narrow the directory or inspect one file.',
      filterLabel: 'Line filter',
      fileRowLabel: 'File {path}, {status}, {pairs} pairs, {flagged} flagged',
      reasonsTitle: 'Split reasons',
      flagsTitle: 'Flags',
      filesTitle: 'Files needing review',
      filesTitleAll: 'All files',
      fileColumn: 'File',
      formatColumn: 'Format',
      statusColumn: 'Status',
      pairsColumn: 'Pairs',
      flaggedColumn: 'Flagged',
      noFilesFlagged: 'No file needs review.',
      noBackupShort: 'no backup',
      noBackupHint: '{count} file(s) have no LRC backup or legacy .bak, so they cannot be compared or restored.',
      backupSummary: 'Backups: LRC {lrc} · legacy .bak {legacy} · none {none}; root: {root}',
      linesTitleAll: 'Flagged split lines',
      linesTitleAllLines: 'All split lines',
      linesTitleFile: 'Lines in “{file}”',
      filterFlagged: 'Flagged',
      filterAll: 'All',
      limitLabel: 'Limit',
      backToAll: 'Back to directory',
      showing: 'Showing {shown} of {matched}',
      truncatedHint: 'Results are truncated: select a file or change the filter to narrow them.',
      loadingLines: 'Reading this file…',
      fileFailed: 'Could not read this file: {message}',
      emptyFlaggedLines: 'No flagged line in this view.',
      emptyAllLines: 'No split pair in this view.',
      selectFileHint: 'Select a file above to see its lines and restore it.',
      revert: 'Restore lyrics',
      revertTitle: 'Restore this file from its backup?',
      revertBody: 'The current lyrics return to the original text stored in the LRC backup; audio and cover bytes are unchanged and the backup is kept. Review then reports the file as unsplit / manually edited.',
      revertBackup: 'LRC backup: {backup}',
      revertBackupLegacy: 'Legacy .bak: {backup}',
      revertConfirm: 'Restore',
      revertSkipped: 'This file has no LRC backup or legacy .bak, so it cannot be restored.',
      cancel: 'Cancel',
      reverting: 'Restoring…',
      reverted: 'Restored {file}. The LRC backup was kept.',
      revertPartial: 'Restore finished with {count} error(s): {message}',
      revertFailed: 'Restore failed: {message}',
      statusConverted: 'Converted',
      statusAlreadyOk: 'Already ok',
      statusManualEdit: 'Manual edit',
      statusNoLyrics: 'No lyrics',
      statusWouldChange: 'Needs conversion',
      statusError: 'Error',
      statusUnknown: 'Unknown',
    };

    const CSS = `
      .lr-page { display: flex; flex-direction: column; gap: 18px; width: 100%; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
      .lr-page, .lr-page *, .lr-page *::before, .lr-page *::after { box-sizing: border-box; }
      .lr-header h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }
      .lr-header p { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .lr-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; }
      .lr-label { display: block; font-size: 13px; line-height: 20px; font-weight: 500; }
      .lr-scan-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
      .lr-input { flex: 1 1 260px; min-width: 0; height: 34px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
      .lr-input::placeholder { color: var(--dsw-alias-label-secondary); }
      .lr-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .lr-btn { height: 34px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
      .lr-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .lr-btn:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }
      .lr-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .lr-btn-primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); }
      .lr-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
      .lr-btn-danger { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-state-error-primary); }
      .lr-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
      .lr-hint { margin: 6px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .lr-notice { border: 1px solid; border-left-width: 3px; border-radius: var(--dsw-radius-md); padding: 8px 12px; font-size: 13px; line-height: 19px; color: var(--dsw-alias-label-primary); }
      .lr-notice-success { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); border-left-color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
      .lr-notice-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); border-left-color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
      .lr-muted { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .lr-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .lr-stat { min-width: 86px; padding: 6px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); }
      .lr-stat-value { font-size: 16px; line-height: 22px; font-weight: 500; font-variant-numeric: tabular-nums; }
      .lr-stat-label { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); }
      .lr-chip-group { margin-top: 10px; }
      .lr-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
      .lr-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .lr-chip-warn { color: var(--dsw-alias-label-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); }
      .lr-section-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
      .lr-section-title { margin: 0; font-size: 13px; line-height: 20px; font-weight: 500; }
      .lr-file-table { margin-top: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); overflow: hidden; }
      .lr-file-head, .lr-file-row { display: grid; grid-template-columns: minmax(0, 1fr) 52px 88px 48px 56px; gap: 8px; align-items: center; padding: 6px 10px; }
      .lr-file-head { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-module-platform); }
      .lr-file-row { width: 100%; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer; }
      .lr-file-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .lr-file-row.is-selected { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
      .lr-file-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
      .lr-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lr-file-format, .lr-file-status, .lr-file-tag { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .lr-file-tag { font-style: italic; }
      .lr-file-num { text-align: right; font-variant-numeric: tabular-nums; }
      .lr-file-num.is-warn { color: var(--dsw-alias-label-primary); font-weight: 500; }
      .lr-scroll-files { max-height: 248px; overflow-y: auto; }
      .lr-lines { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .lr-line { border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid transparent; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; }
      .lr-line.is-flagged { border-left-color: var(--dsw-alias-state-warn-primary); }
      .lr-line-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
      .lr-time { flex: none; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .lr-reason { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .lr-bodies { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
      .lr-jp { font-size: 14px; line-height: 21px; word-break: break-word; }
      .lr-zh { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); word-break: break-word; }
      .lr-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .lr-flag { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
      .lr-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
      .lr-toggle { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); overflow: hidden; }
      .lr-toggle button { height: 28px; padding: 0 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
      .lr-toggle button.is-active { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); }
      .lr-select { height: 28px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
      .lr-empty { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .lr-loading { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .lr-spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent); border-top-color: var(--dsw-alias-label-secondary); border-radius: 50%; animation: lr-spin 0.8s linear infinite; }
      @keyframes lr-spin { to { transform: rotate(360deg); } }
      .lr-backup-note { margin-top: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .lr-break { word-break: break-all; }
      .lr-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--dsw-alias-bg-mask-1); }
      .lr-dialog { width: min(440px, 100%); max-height: calc(100vh - 48px); overflow-y: auto; padding: 18px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-panel); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-prominent); }
      .lr-dialog h3 { margin: 0 0 8px; font-size: 15px; line-height: 22px; font-weight: 500; }
      .lr-dialog p { margin: 0 0 8px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .lr-dialog-path { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; line-height: 18px; word-break: break-all; color: var(--dsw-alias-label-primary); }
      .lr-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;

    /** @param {unknown} error */
    function messageOf(error) {
      return error && error.message ? error.message : String(error);
    }

    /** @param {Record<string, number> | undefined} counts */
    function sortedCounts(counts) {
      return Object.entries(counts || {}).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    }

    /** @param {string} action @param {object} body @param {AbortSignal | undefined} signal */
    async function post(action, body, signal) {
      const response = await fetch(`${API}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
      }
      if (payload === null || typeof payload !== 'object') {
        throw new Error('the Host returned an invalid response');
      }
      return payload;
    }

    /** @returns {string} remembered directory, or '' when storage is unavailable */
    function readRememberedDirectory() {
      try {
        return window.localStorage.getItem(DIRECTORY_KEY) || '';
      } catch {
        return '';
      }
    }

    /** @param {string} directory */
    function rememberDirectory(directory) {
      try {
        window.localStorage.setItem(DIRECTORY_KEY, directory);
      } catch {
        // Storage is optional; the panel still works without it.
      }
    }

    /** @param {string} text */
    function statusLabel(t, status) {
      const key = {
        converted: 'statusConverted',
        'already-ok': 'statusAlreadyOk',
        'manual-edit': 'statusManualEdit',
        'no-lyrics': 'statusNoLyrics',
        'would-change': 'statusWouldChange',
        error: 'statusError',
      }[status];
      return key ? t(key) : (status || t('statusUnknown'));
    }

    function Panel(props) {
      const t = props.t || ((key) => key);
      const pickDirectory = props.pickDirectory;
      const subscribeLocale = props.subscribeLocale || (() => () => {});

      const [localeRevision, setLocaleRevision] = React.useState(0);
      React.useEffect(() => subscribeLocale(() => setLocaleRevision((value) => value + 1)), [subscribeLocale]);

      const [input, setInput] = React.useState(readRememberedDirectory);
      const [directory, setDirectory] = React.useState('');
      const [scan, setScan] = React.useState(null);
      const [scanState, setScanState] = React.useState('idle');
      const [scanError, setScanError] = React.useState('');
      const [filter, setFilter] = React.useState('flagged');
      const [limit, setLimit] = React.useState(100);
      const [selected, setSelected] = React.useState(null);
      const [fileView, setFileView] = React.useState(null);
      const [fileState, setFileState] = React.useState('idle');
      const [fileError, setFileError] = React.useState('');
      const [notice, setNotice] = React.useState(null);
      const [confirmOpen, setConfirmOpen] = React.useState(false);
      const [reverting, setReverting] = React.useState(false);

      const scanSequence = React.useRef(0);
      const fileSequence = React.useRef(0);
      const scanAbort = React.useRef(null);
      const fileAbort = React.useRef(null);
      const dialogRef = React.useRef(null);
      const cancelButton = React.useRef(null);
      const previousFocus = React.useRef(null);

      React.useEffect(() => () => {
        if (scanAbort.current) scanAbort.current.abort();
        if (fileAbort.current) fileAbort.current.abort();
      }, []);

      React.useEffect(() => {
        if (confirmOpen) {
          previousFocus.current = document.activeElement;
          if (cancelButton.current) cancelButton.current.focus();
          return undefined;
        }
        const target = previousFocus.current;
        previousFocus.current = null;
        if (target && typeof target.focus === 'function') target.focus();
        return undefined;
      }, [confirmOpen]);

      React.useEffect(() => {
        if (!confirmOpen) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setConfirmOpen(false);
            return;
          }
          if (event.key !== 'Tab') return;
          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = dialog.querySelectorAll('button, [href], input, select, textarea');
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, [confirmOpen]);

      async function scanDirectory(target, filterValue, limitValue, options) {
        const trimmed = typeof target === 'string' ? target.trim() : '';
        if (trimmed === '') {
          setNotice({ kind: 'error', text: t('needDirectory') });
          return;
        }
        const sequence = ++scanSequence.current;
        if (scanAbort.current) scanAbort.current.abort();
        const controller = new AbortController();
        scanAbort.current = controller;
        setScanState('loading');
        setScanError('');
        if (!options || !options.keepNotice) setNotice(null);
        if (!options || !options.keepSelection) {
          setSelected(null);
          setFileView(null);
          setFileState('idle');
          setFileError('');
        }
        try {
          const result = await post('review', { directory: trimmed, filter: filterValue, limit: limitValue }, controller.signal);
          if (sequence !== scanSequence.current) return;
          setScan(result);
          setDirectory(result.directory);
          setInput(result.directory);
          rememberDirectory(result.directory);
          setScanState('ready');
          if (options && options.keepSelection && options.select) {
            loadFile(result.directory, options.select, filterValue, limitValue);
          }
        } catch (error) {
          if (controller.signal.aborted || sequence !== scanSequence.current) return;
          setScanError(messageOf(error));
          setScanState('error');
          if (!scan) setScan(null);
        } finally {
          if (sequence === scanSequence.current) scanAbort.current = null;
        }
      }

      async function loadFile(targetDirectory, file, filterValue, limitValue) {
        const sequence = ++fileSequence.current;
        if (fileAbort.current) fileAbort.current.abort();
        const controller = new AbortController();
        fileAbort.current = controller;
        setFileState('loading');
        setFileError('');
        setFileView(null);
        try {
          const result = await post('review', {
            directory: targetDirectory,
            file,
            filter: filterValue,
            limit: limitValue,
          }, controller.signal);
          if (sequence !== fileSequence.current) return;
          setFileView(result);
          setFileState('ready');
        } catch (error) {
          if (controller.signal.aborted || sequence !== fileSequence.current) return;
          setFileError(messageOf(error));
          setFileState('error');
          setFileView(null);
        } finally {
          if (sequence === fileSequence.current) fileAbort.current = null;
        }
      }

      async function chooseDirectory() {
        if (!pickDirectory) return;
        try {
          const picked = await pickDirectory();
          if (typeof picked === 'string' && picked !== '') setInput(picked);
        } catch (error) {
          setNotice({ kind: 'error', text: t('pickFailed', { message: messageOf(error) }) });
        }
      }

      function submitScan(event) {
        if (event) event.preventDefault();
        scanDirectory(input, filter, limit);
      }

      function changeFilter(next) {
        if (next === filter) return;
        setFilter(next);
        setNotice(null);
        if (!scan || !directory) return;
        scanDirectory(directory, next, limit, { keepSelection: Boolean(selected), select: selected });
      }

      function changeLimit(next) {
        const value = Number(next);
        if (value === limit) return;
        setLimit(value);
        setNotice(null);
        if (!scan || !directory) return;
        scanDirectory(directory, filter, value, { keepSelection: Boolean(selected), select: selected });
      }

      function selectFile(path) {
        setNotice(null);
        if (selected === path) {
          setSelected(null);
          setFileView(null);
          setFileState('idle');
          setFileError('');
          return;
        }
        setSelected(path);
        loadFile(directory, path, filter, limit);
      }

      async function confirmRevert() {
        if (!selected || !directory) return;
        setReverting(true);
        setNotice(null);
        try {
          const result = await post('revert', { directory, file: selected, confirm: true });
          const restored = result.counts && result.counts.restored ? result.counts.restored : 0;
          if (result.errors && result.errors.length > 0) {
            setNotice({
              kind: 'error',
              text: t('revertPartial', {
                count: String(result.errors.length),
                message: result.errors[0].error,
              }),
            });
          } else if (restored > 0) {
            setNotice({ kind: 'success', text: t('reverted', { file: selected }) });
          } else {
            setNotice({ kind: 'error', text: t('revertFailed', { message: t('revertSkipped') }) });
          }
          setConfirmOpen(false);
          await scanDirectory(directory, filter, limit, { keepSelection: true, select: selected, keepNotice: true });
        } catch (error) {
          setNotice({ kind: 'error', text: t('revertFailed', { message: messageOf(error) }) });
        } finally {
          setReverting(false);
        }
      }

      const summary = scan ? scan.summary : null;
      const fileEntries = scan ? scan.files.slice().sort((left, right) => {
        const delta = right.flagged - left.flagged;
        return delta !== 0 ? delta : left.path.localeCompare(right.path);
      }) : [];
      const selectedEntry = selected ? fileEntries.find((entry) => entry.path === selected) : undefined;
      const selectedFileEntry = selectedEntry
        || (fileView && fileView.files && fileView.files[0])
        || null;
      const selectedHasBackup = Boolean(selectedFileEntry && selectedFileEntry.hasBackup);
      const activeView = selected ? fileView : scan;
      const activeLines = activeView ? activeView.lines : [];
      const activeMatched = activeView ? activeView.linesMatched : 0;
      const activeReturned = activeView ? activeView.linesReturned : 0;
      const activeTruncated = activeView ? activeView.truncated : false;
      const lineTitle = selected
        ? t('linesTitleFile', { file: selected })
        : (filter === 'all' ? t('linesTitleAllLines') : t('linesTitleAll'));
      const filesTitle = filter === 'all' ? t('filesTitleAll') : t('filesTitle');
      const backupPath = selectedFileEntry && selectedFileEntry.backup ? selectedFileEntry.backup : '';
      const backupKind = selectedFileEntry && selectedFileEntry.backupKind ? selectedFileEntry.backupKind : '';
      const backupLabel = backupPath
        ? (backupKind === 'legacy'
          ? t('revertBackupLegacy', { backup: backupPath })
          : t('revertBackup', { backup: backupPath }))
        : '';

      const stats = summary ? [
        ['filesScanned', summary.filesScanned],
        ['withBackup', summary.filesWithBackup],
        ['pairs', summary.pairs],
        ['flaggedPairs', summary.flaggedPairs],
        ['titleLines', summary.titleLines],
        ['converted', summary.converted],
        ['manualEdits', summary.manualEdits],
        ['alreadyOk', summary.alreadyOk],
        ['noLyrics', summary.noLyrics],
        ['needsConversion', summary.needsConversion],
        ['noBackup', summary.noBackup],
        ['errors', summary.errors],
      ] : [];

      const reasons = summary ? sortedCounts(summary.reasons) : [];
      const flags = summary ? sortedCounts(summary.flags) : [];
      const fileFlags = summary ? sortedCounts(summary.fileFlags) : [];

      const showIdle = scan === null && (scanState === 'idle' || scanState === 'error');
      const showLoadingEmpty = scanState === 'loading' && scan === null;
      const showSummary = scan !== null;

      return h('div', { className: 'lr-page', 'data-lyrics-review-panel': 'true', 'aria-busy': scanState === 'loading' ? 'true' : undefined },
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'lr-header' },
          h('h2', null, t('title')),
          h('p', null, t('description')),
        ),
        h('div', { className: 'lr-card' },
          h('form', { onSubmit: submitScan },
            h('label', { className: 'lr-label', htmlFor: 'lr-directory' }, t('directoryLabel')),
            h('div', { className: 'lr-scan-controls' },
              h('input', {
                id: 'lr-directory',
                className: 'lr-input',
                type: 'text',
                value: input,
                placeholder: t('directoryPlaceholder'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => setInput(event.target.value),
              }),
              pickDirectory
                ? h('button', {
                  type: 'button',
                  className: 'lr-btn',
                  onClick: chooseDirectory,
                  disabled: scanState === 'loading',
                }, t('pick'))
                : null,
              h('button', {
                type: 'submit',
                className: 'lr-btn lr-btn-primary',
                disabled: scanState === 'loading',
              }, scanState === 'loading' ? t('scanning') : (scan ? t('rescan') : t('scan'))),
            ),
            h('p', { className: 'lr-hint' }, t('scanHint')),
          ),
          scanError
            ? h('div', { key: 'scan-error', className: 'lr-notice lr-notice-error', role: 'alert', style: { marginTop: '10px' } }, t('scanFailed', { message: scanError }))
            : null,
        ),
        notice
          ? h('div', {
            key: 'notice',
            className: `lr-notice ${notice.kind === 'error' ? 'lr-notice-error' : 'lr-notice-success'}`,
            role: notice.kind === 'error' ? 'alert' : 'status',
          }, notice.text)
          : null,
        showIdle
          ? h('div', { className: 'lr-card' },
            h('h3', { className: 'lr-section-title' }, t('idleTitle')),
            h('p', { className: 'lr-muted', style: { margin: '6px 0 0' } }, t('idleBody')),
          )
          : null,
        showLoadingEmpty
          ? h('div', { className: 'lr-card' },
            h('div', { className: 'lr-loading' },
              h('span', { className: 'lr-spinner', 'aria-hidden': 'true' }),
              h('span', null, t('scanning')),
            ),
          )
          : null,
        showSummary && summary && summary.filesScanned === 0
          ? h('div', { className: 'lr-card' }, h('div', { className: 'lr-empty' }, t('emptyDirectory')))
          : null,
        showSummary && summary && summary.filesScanned > 0
          ? h(React.Fragment, { key: 'summary' },
            h('div', { className: 'lr-card' },
              h('div', { className: 'lr-section-head' },
                h('h3', { className: 'lr-section-title' }, t('summaryTitle')),
                h('span', { className: 'lr-muted', title: directory }, directory),
              ),
              h('div', { className: 'lr-stats' },
                ...stats.map(([key, value]) => h('div', { key, className: 'lr-stat' },
                  h('div', { className: 'lr-stat-value' }, String(value)),
                  h('div', { className: 'lr-stat-label' }, t(key)),
                )),
              ),
              reasons.length > 0
                ? h('div', { className: 'lr-chip-group' },
                  h('div', { className: 'lr-stat-label' }, t('reasonsTitle')),
                  h('div', { className: 'lr-chips' },
                    ...reasons.map(([name, count]) => h('span', { key: name, className: 'lr-chip' }, `${name} ${count}`)),
                  ),
                )
                : null,
              flags.length > 0
                ? h('div', { className: 'lr-chip-group' },
                  h('div', { className: 'lr-stat-label' }, t('flagsTitle')),
                  h('div', { className: 'lr-chips' },
                    ...flags.map(([name, count]) => h('span', { key: name, className: 'lr-chip lr-chip-warn' }, `${name} ${count}`)),
                  ),
                )
                : null,
              summary.backupRoot
                ? h('p', { className: 'lr-hint lr-break' }, t('backupSummary', {
                  lrc: String(summary.filesWithLrcBackup || 0),
                  legacy: String(summary.filesWithLegacyBackup || 0),
                  none: String(summary.noBackup || 0),
                  root: summary.backupRoot,
                }))
                : (summary.noBackup > 0
                  ? h('p', { className: 'lr-hint' }, t('noBackupHint', { count: String(summary.noBackup) }))
                  : null),
            ),
            h('div', { className: 'lr-card' },
              h('div', { className: 'lr-section-head' },
                h('h3', { className: 'lr-section-title' }, filesTitle),
                h('span', { className: 'lr-muted' }, t('filesCount', { count: String(fileEntries.length) })),
              ),
              fileEntries.length === 0
                ? h('div', { className: 'lr-empty', style: { marginTop: '8px' } }, t('noFilesFlagged'))
                : h('div', { className: 'lr-file-table' },
                  h('div', { className: 'lr-file-head' },
                    h('span', null, t('fileColumn')),
                    h('span', null, t('formatColumn')),
                    h('span', null, t('statusColumn')),
                    h('span', { style: { textAlign: 'right' } }, t('pairsColumn')),
                    h('span', { style: { textAlign: 'right' } }, t('flaggedColumn')),
                  ),
                  h('div', { className: 'lr-scroll-files' },
                    ...fileEntries.map((entry) => h('button', {
                      key: entry.path,
                      type: 'button',
                      className: `lr-file-row${selected === entry.path ? ' is-selected' : ''}`,
                      onClick: () => selectFile(entry.path),
                      'aria-pressed': selected === entry.path,
                      'aria-label': t('fileRowLabel', {
                        path: entry.path,
                        status: statusLabel(t, entry.status),
                        pairs: String(entry.pairs),
                        flagged: String(entry.flagged),
                      }),
                      title: entry.error ? `${entry.path}: ${entry.error}` : entry.path,
                    },
                    h('span', { className: 'lr-file-name' }, entry.path),
                    h('span', { className: 'lr-file-format' }, (entry.format || '').toUpperCase()),
                    h('span', { className: 'lr-file-status' }, statusLabel(t, entry.status)),
                    h('span', { className: 'lr-file-num' }, String(entry.pairs)),
                    h('span', { className: `lr-file-num${entry.flagged > 0 ? ' is-warn' : ''}` }, String(entry.flagged)),
                    )),
                  ),
                ),
              fileFlags.length > 0
                ? h('div', { className: 'lr-chips', style: { marginTop: '10px' } },
                  ...fileFlags.map(([name, count]) => h('span', { key: name, className: 'lr-chip lr-chip-warn' }, `${name} ${count}`)),
                )
                : null,
              scan.filesOmitted > 0
                ? h('p', { className: 'lr-hint' }, t('filesOmittedHint', { count: String(scan.filesOmitted) }))
                : null,
            ),
            h('div', { className: 'lr-card' },
              h('div', { className: 'lr-section-head' },
                h('h3', { className: 'lr-section-title' }, lineTitle),
                h('div', { className: 'lr-controls' },
                  h('div', { className: 'lr-toggle', role: 'group', 'aria-label': t('filterLabel') },
                    ...FILTERS.map((value) => h('button', {
                      key: value,
                      type: 'button',
                      className: filter === value ? 'is-active' : '',
                      'aria-pressed': filter === value,
                      onClick: () => changeFilter(value),
                    }, value === 'flagged' ? t('filterFlagged') : t('filterAll'))),
                  ),
                  h('label', { className: 'lr-muted', htmlFor: 'lr-limit' }, t('limitLabel')),
                  h('select', {
                    id: 'lr-limit',
                    className: 'lr-select',
                    value: String(limit),
                    onChange: (event) => changeLimit(event.target.value),
                  }, ...LIMITS.map((value) => h('option', { key: value, value: String(value) }, String(value)))),
                  selected
                    ? h('button', { type: 'button', className: 'lr-btn', style: { height: '28px' }, onClick: () => selectFile(selected) }, t('backToAll'))
                    : null,
                ),
              ),
              selected && !selectedHasBackup
                ? h('p', { className: 'lr-backup-note' }, t('noBackupShort'))
                : null,
              h('div', { className: 'lr-controls' },
                h('span', { className: 'lr-muted' }, t('showing', { shown: String(activeReturned), matched: String(activeMatched) })),
                activeTruncated ? h('span', { className: 'lr-muted' }, t('truncatedHint')) : null,
              ),
              fileState === 'loading' && selected
                ? h('div', { className: 'lr-loading' },
                  h('span', { className: 'lr-spinner', 'aria-hidden': 'true' }),
                  h('span', null, t('loadingLines')),
                )
                : null,
              fileState === 'error' && selected
                ? h('div', { className: 'lr-empty', role: 'alert' }, t('fileFailed', { message: fileError }))
                : null,
              activeLines.length === 0 && (!selected || fileState === 'ready')
                ? h('div', { className: 'lr-empty', style: { marginTop: '8px' } }, filter === 'flagged' ? t('emptyFlaggedLines') : t('emptyAllLines'))
                : null,
              !selected && activeLines.length > 0
                ? h('p', { className: 'lr-hint' }, t('selectFileHint'))
                : null,
              activeLines.length > 0
                ? h('ul', { className: 'lr-lines' },
                  ...activeLines.map((line, index) => h('li', {
                    key: `${line.file}:${line.timestamp}:${index}`,
                    className: `lr-line${line.flagged ? ' is-flagged' : ''}`,
                  },
                  h('div', { className: 'lr-line-head' },
                    h('span', { className: 'lr-time' }, line.timestamp),
                    h('span', { className: 'lr-reason' }, line.reason),
                  ),
                  h('div', { className: 'lr-bodies' },
                    h('div', { className: 'lr-jp' }, line.jp || line.original),
                    line.zh ? h('div', { className: 'lr-zh' }, line.zh) : null,
                  ),
                  line.flags.length > 0
                    ? h('div', { className: 'lr-flags' },
                      ...line.flags.map((flag) => h('span', { key: flag, className: 'lr-flag' }, flag)),
                    )
                    : null,
                  )),
                )
                : null,
              selected
                ? h('div', { className: 'lr-controls', style: { marginTop: '12px' } },
                  h('button', {
                    type: 'button',
                    className: 'lr-btn lr-btn-danger',
                    disabled: !selectedHasBackup || reverting,
                    onClick: () => setConfirmOpen(true),
                  }, t('revert')),
                  backupLabel && selectedHasBackup
                    ? h('span', { className: 'lr-backup-note', style: { marginTop: 0 } }, backupLabel)
                    : null,
                )
                : null,
            ),
          )
          : null,
        confirmOpen
          ? h('div', {
            key: 'confirm',
            className: 'lr-overlay',
            onClick: (event) => {
              if (event.target === event.currentTarget && !reverting) setConfirmOpen(false);
            },
          },
          h('div', {
            className: 'lr-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'lr-dialog-title',
            'aria-describedby': 'lr-dialog-body',
            ref: dialogRef,
          },
          h('h3', { id: 'lr-dialog-title' }, t('revertTitle')),
          h('p', { id: 'lr-dialog-body' }, t('revertBody')),
          selected ? h('p', { className: 'lr-dialog-path' }, selected) : null,
          backupLabel ? h('p', { className: 'lr-dialog-path' }, backupLabel) : null,
          h('div', { className: 'lr-dialog-actions' },
            h('button', {
              type: 'button',
              className: 'lr-btn',
              disabled: reverting,
              ref: cancelButton,
              onClick: () => setConfirmOpen(false),
            }, t('cancel')),
            h('button', {
              type: 'button',
              className: 'lr-btn lr-btn-danger',
              disabled: reverting,
              onClick: confirmRevert,
            }, reverting ? t('reverting') : t('revertConfirm')),
          ),
          ),
          )
          : null,
        h('span', { key: 'locale-revision', hidden: true }, String(localeRevision)),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, 'zh', ZH),
            ctx.locale.register(NS, 'en', EN),
          ];
          return () => {
            for (const dispose of disposers.reverse()) dispose();
          };
        }, 'lyrics-review: panel dictionaries');
        const uiWorkspace = ctx.get('uiWorkspace');
        const pickDirectory = uiWorkspace && typeof uiWorkspace.pickDirectory === 'function'
          ? () => {
            const service = ctx.get('uiWorkspace');
            return service && typeof service.pickDirectory === 'function'
              ? service.pickDirectory()
              : Promise.resolve(null);
          }
          : undefined;
        const subscribeLocale = (listener) => ctx.locale.subscribe(listener);
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'nihongo-lyrics-match',
          order: 30,
          label: () => t('sectionLabel'),
          locale: NS,
          inject: () => ({ pickDirectory, subscribeLocale }),
        }, Panel)), 'lyrics-review: settings panel');
      },
    };
  },
});
