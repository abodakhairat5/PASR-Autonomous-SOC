// ask_user tool. The model uses this to surface a multi-choice question
// to the human. Not gated by the permission modal — the question itself
// IS the human-in-the-loop step.

import type { AskPrompter, Option, Question } from '../ask/ask.js';
import type { Prompter } from '../permission/permission.js';
import type { Tool } from './types.js';

const AUTHORIZED_TESTING_OPTION: Option = {
  label: 'Authorized testing',
  description: 'I have permission to test this target.',
};

export class AskUserTool implements Tool {
  private readonly prompter: AskPrompter;

  constructor(prompter: AskPrompter) {
    this.prompter = prompter;
  }

  name(): string {
    return 'ask_user';
  }

  description(): string {
    return [
      'Ask the user a multiple-choice question to disambiguate or get a decision. Use when there are several distinct ways to proceed and you need the user to pick one — e.g. "Which user session should I test as for IDOR?", "Should I escalate from passive probing to active SQLi tests?", "Which of these advisories matches the version banner?".',
      '',
      'Returns the label of the chosen option as JSON: {"answers":[{"question":"...","answer":"..."}]}.',
      '',
      'The user can press Esc to cancel — your tool result will be an error and you should adapt rather than re-asking the same question. Do NOT use this for confirming dangerous side effects (those are gated by the permission modal already), and do NOT use it for fully open-ended clarification (ask in plain text instead). Reserve it for genuine multiple-choice branches.',
    ].join('\n');
  }

  schema(): Record<string, unknown> {
    const optionSchema = {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'The choice text shown to the user (1-5 words ideal).',
        },
        description: { type: 'string', description: 'Optional one-line explanation.' },
      },
      required: ['label'],
    };
    const questionSchema = {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The full question, ending in a question mark.' },
        header: {
          type: 'string',
          description: 'Optional very-short label (~12 chars) shown as a chip above the question.',
        },
        options: { type: 'array', minItems: 2, maxItems: 8, items: optionSchema },
      },
      required: ['question', 'options'],
    };
    return {
      type: 'object',
      properties: {
        questions: { type: 'array', minItems: 1, maxItems: 4, items: questionSchema },
      },
      required: ['questions'],
    };
  }

  requiresPermission(): boolean {
    return false;
  }

  summarize(args: Record<string, unknown>): { summary: string; detail: string } {
    return { summary: 'ask_user: multiple-choice question', detail: JSON.stringify(args, null, 2) };
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, _p: Prompter): Promise<string> {
    const raw = args.questions;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('questions is required (array of {question, options})');
    }

    const answers: Array<{ question: string; answer: string }> = [];
    for (let i = 0; i < raw.length; i += 1) {
      const qm = raw[i] as Record<string, unknown>;
      const qtext = typeof qm.question === 'string' ? qm.question : '';
      if (!qtext) throw new Error(`questions[${i}]: question text is required`);
      const header = typeof qm.header === 'string' ? qm.header : undefined;
      const rawOpts = Array.isArray(qm.options) ? qm.options : [];
      const opts: Option[] = [];
      for (const ro of rawOpts) {
        const om = ro as Record<string, unknown>;
        const label = typeof om.label === 'string' ? om.label : '';
        const description = typeof om.description === 'string' ? om.description : undefined;
        if (label) opts.push({ label, description });
      }
      addAuthorizedTestingOption(qtext, header, opts);
      if (opts.length < 2) throw new Error(`questions[${i}]: at least 2 options required`);

      const question: Question = { question: qtext, options: opts };
      if (header) question.header = header;
      const choice = await this.prompter.ask(question, signal);
      answers.push({ question: qtext, answer: choice });
    }

    return JSON.stringify({ answers }, null, 2);
  }
}

function addAuthorizedTestingOption(
  question: string,
  header: string | undefined,
  opts: Option[],
): void {
  if (!isAuthorizationScopeQuestion(question, header)) return;
  if (opts.some((o) => o.label.toLowerCase() === AUTHORIZED_TESTING_OPTION.label.toLowerCase())) {
    return;
  }
  opts.unshift(AUTHORIZED_TESTING_OPTION);
}

function isAuthorizationScopeQuestion(question: string, header: string | undefined): boolean {
  const text = `${header ?? ''} ${question}`.toLowerCase();
  return (
    text.includes('authorized to test') ||
    text.includes('permission to test') ||
    (text.includes('scope') && text.includes('target')) ||
    (text.includes('authorized') && text.includes('target'))
  );
}
