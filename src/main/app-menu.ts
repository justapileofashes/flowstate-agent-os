import { app, BrowserWindow, dialog, Menu, shell } from 'electron';

// Flowstate ships Windows-only. Menu uses Windows conventions (Alt mnemonics,
// File → Exit). Visual design is mac-inspired but the runtime targets
// Windows.
export function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        {
          label: 'Open command palette',
          accelerator: 'Ctrl+K',
          click: (_m, win) => {
            (win as BrowserWindow | undefined)?.webContents.send('app:trigger-palette');
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit', accelerator: 'Alt+F4' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
    {
      role: 'help',
      label: '&Help',
      submenu: [
        {
          label: 'Ollama (local LLM runtime)',
          click: () => {
            void shell.openExternal('https://ollama.com');
          },
        },
        {
          label: 'About Flowstate',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About Flowstate',
              message: 'Flowstate',
              detail:
                'Local AI agent dashboard powered by Ollama.\n' +
                `Version ${app.getVersion()}\n\n` +
                'Runs entirely on your machine. No cloud, no telemetry, no API keys.\n\n' +
                'Built with Electron + React + Tailwind + framer-motion.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
