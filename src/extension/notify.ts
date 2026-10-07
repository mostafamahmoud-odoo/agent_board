import * as vscode from 'vscode';

import type { FeedbackKind } from '../shared/protocol.js';
import { markAllConsumed, pendingCount, readFeedbackSafe } from './feedback.js';

/**
 * Closes the loop with the *user* (FR-031, FR-032).
 *
 * The channel to the agent stays one-way and file-based, so any agent that can
 * read `.agent/notes_feedback.json` keeps working (FR-033). What was missing
 * is that answering felt like it did nothing: the reply sat in a file until
 * the agent happened to be invoked again. Now VS Code says the reply was
 * captured and offers a one-click handoff.
 */

function describe(kind: FeedbackKind, payload: unknown): string {
  const text = (payload as { text?: string })?.text;
  if (kind === 'answer') return text ? `Answer saved: "${truncate(text, 60)}"` : 'Answer saved';
  if (kind === 'sticky') return text ? `Note saved: "${truncate(text, 60)}"` : 'Note saved';
  return 'Drawing saved';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export async function notifyCaptured(kind: FeedbackKind, payload: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('agentBoard');
  if (!cfg.get<boolean>('notifyOnFeedback', true)) return;

  const pending = pendingCount();
  const msg = `${describe(kind, payload)} — ${pending} reply${pending === 1 ? '' : 'ies'} waiting for your agent.`;
  const COPY = 'Copy for your agent';
  const MUTE = 'Stop telling me';

  const choice = await vscode.window.showInformationMessage(msg, COPY, MUTE);
  if (choice === COPY) await handOff();
  else if (choice === MUTE) await cfg.update('notifyOnFeedback', false, vscode.ConfigurationTarget.Global);
}

/**
 * Builds a self-contained message the user can paste into their agent, then
 * marks the entries consumed so the same answer is never applied twice
 * (FR-014).
 */
export async function handOff(): Promise<void> {
  const log = readFeedbackSafe();
  const answers = log.answers.filter((a) => !a.consumed);
  const stickies = log.stickies.filter((s) => !s.consumed);
  const drawings = log.drawings.filter((d) => !d.consumed);

  if (!answers.length && !stickies.length && !drawings.length) {
    void vscode.window.showInformationMessage('Agent Board: nothing new on the board.');
    return;
  }

  const lines: string[] = ['I left some replies on the notes board:'];
  for (const a of answers) {
    lines.push(`- Q: ${a.question ?? a.questionId}`);
    lines.push(`  A: ${a.text}`);
  }
  for (const s of stickies) lines.push(`- Sticky note: "${s.text}"`);
  if (drawings.length) {
    lines.push(
      `- ${drawings.length} pen mark${drawings.length === 1 ? '' : 's'} on the board (coordinates are approximate; ask if it is not clear what they point at).`
    );
  }
  lines.push('', 'They are in .agent/notes_feedback.json.');

  await vscode.env.clipboard.writeText(lines.join('\n'));
  try {
    markAllConsumed();
  } catch {
    /* a corrupt log is reported elsewhere; the clipboard copy still stands */
  }
  vscode.window.setStatusBarMessage('$(clippy) Agent Board: replies copied — paste them to your agent', 4000);
}
