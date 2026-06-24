import { ipcMain, shell } from 'electron';
import { stat } from 'node:fs/promises';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import { FileTools } from '@main/tools';
import { resolveSafe } from '@main/tools/path-sandbox';

const READ_CAP_BYTES = 100_000;

export function registerFileHandlers(): void {
  ipcMain.handle(CHANNELS.FILES_LIST, async (_e, raw) => {
    const { workspacePath, subPath } = schemas.filesListRequest.parse(raw);
    const tools = new FileTools(workspacePath);
    const entries = await tools.listDir(subPath ?? '.');
    return { entries };
  });

  ipcMain.handle(CHANNELS.FILES_READ, async (_e, raw) => {
    const { workspacePath, relPath } = schemas.filesReadRequest.parse(raw);
    const full = resolveSafe(workspacePath, relPath);
    const s = await stat(full);
    if (s.isDirectory()) {
      throw new Error(`not a file: ${relPath}`);
    }
    const tools = new FileTools(workspacePath);
    const content = await tools.readFile(relPath);
    if (content.length > READ_CAP_BYTES) {
      return {
        content: content.slice(0, READ_CAP_BYTES) + '\n\n[truncated]',
        truncated: true,
        sizeBytes: s.size,
      };
    }
    return { content, truncated: false, sizeBytes: s.size };
  });

  ipcMain.handle(CHANNELS.SHELL_OPEN_PATH, async (_e, raw) => {
    const { absolutePath } = schemas.shellOpenPathRequest.parse(raw);
    const err = await shell.openPath(absolutePath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle(CHANNELS.SHELL_OPEN_VSCODE, async (_e, raw) => {
    const { absolutePath } = schemas.shellOpenVscodeRequest.parse(raw);
    // Normalize Windows backslashes; vscode://file/<absolute path>
    const url =
      'vscode://file/' +
      absolutePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:');
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.SHELL_OPEN_URL, async (_e, raw) => {
    const { url } = schemas.shellOpenUrlRequest.parse(raw);
    // Only http(s) allowed to prevent custom-protocol abuse from renderer.
    if (!/^https?:\/\//i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });
}
