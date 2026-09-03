// AskPrompter: a thin abstraction the TUI satisfies. The ask_user tool
// uses it to surface multi-choice questions to the human running the
// session.

export interface Option {
  label: string;
  description?: string;
}

export interface Question {
  header?: string;
  question: string;
  options: Option[];
}

export interface AskPrompter {
  /**
   * Show the question to the user and resolve with the label of the
   * chosen option. Rejects when the user cancels (Esc) or when the
   * provided signal aborts.
   */
  ask(q: Question, signal?: AbortSignal): Promise<string>;
}

/** Hermetic ask prompter for tests: always picks the first option. */
export class FirstOptionPrompter implements AskPrompter {
  async ask(q: Question): Promise<string> {
    const first = q.options[0];
    if (!first) throw new Error('ask: no options');
    return first.label;
  }
}
