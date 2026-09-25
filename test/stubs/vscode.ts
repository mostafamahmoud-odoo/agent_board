/**
 * Minimal `vscode` stand-in for DOM-free unit tests.
 *
 * The real module is provided by the editor at runtime and marked external in
 * the bundle, so it cannot be resolved by a plain Node test runner. Only the
 * surface the pure helpers touch is stubbed; anything needing real editor
 * behaviour belongs in the @vscode/test-electron integration suite.
 */
export const workspace = {
  workspaceFolders: undefined as unknown,
  isTrusted: true,
  getConfiguration: () => ({
    get: <T>(_key: string, fallback?: T): T | undefined => fallback,
    update: () => Promise.resolve()
  }),
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {}
  })
};

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  setStatusBarMessage: () => ({ dispose() {} })
};

export const env = { clipboard: { writeText: () => Promise.resolve() } };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };
export default { workspace, window, env, ConfigurationTarget, ColorThemeKind };
