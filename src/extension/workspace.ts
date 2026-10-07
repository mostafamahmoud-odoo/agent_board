import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Path resolution for the watched workspace folder.
 *
 * Only `workspaceFolders[0]` is watched. That is unchanged from the prototype,
 * but it is now *stated*: `watchedFolderName()` lets the panel name the folder
 * so a multi-root user is never silently looking at another project's board.
 */

export function workspaceRoot(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0] : undefined;
}

export function watchedFolderName(): string | undefined {
  const f = workspaceRoot();
  if (!f) return undefined;
  const multi = (vscode.workspace.workspaceFolders || []).length > 1;
  return multi ? f.name : undefined;
}

function agentDir(): string | undefined {
  const root = workspaceRoot();
  if (!root) return undefined;
  const dir = path.join(root.uri.fsPath, '.agent');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    return undefined;
  }
  return dir;
}

export function notesPath(): string | undefined {
  const dir = agentDir();
  return dir ? path.join(dir, 'notes.json') : undefined;
}

export function feedbackPath(): string | undefined {
  const dir = agentDir();
  return dir ? path.join(dir, 'notes_feedback.json') : undefined;
}

export function libraryDir(): string | undefined {
  const dir = agentDir();
  if (!dir) return undefined;
  const sub = path.join(dir, 'notes');
  try {
    if (!fs.existsSync(sub)) fs.mkdirSync(sub, { recursive: true });
  } catch {
    return undefined;
  }
  return sub;
}

/**
 * In a workspace the user has not trusted, the extension renders read-only:
 * no writes to .agent/, no library saves, no mermaid. Declared in
 * package.json `capabilities.untrustedWorkspaces` as "limited".
 */
export function isWritable(): boolean {
  return vscode.workspace.isTrusted;
}
