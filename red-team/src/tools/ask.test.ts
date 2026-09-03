import { describe, expect, it } from 'vitest';
import type { AskPrompter, Question } from '../ask/ask.js';
import type { Prompter } from '../permission/permission.js';
import { AskUserTool } from './ask.js';

class CaptureAskPrompter implements AskPrompter {
  questions: Question[] = [];

  async ask(q: Question): Promise<string> {
    this.questions.push(q);
    return q.options[0]?.label ?? '';
  }
}

describe('AskUserTool', () => {
  it('adds Authorized testing to authorization scope questions', async () => {
    const prompter = new CaptureAskPrompter();
    const tool = new AskUserTool(prompter);

    const out = await tool.run(
      {
        questions: [
          {
            header: 'Scope',
            question: 'Which target are you authorized to test?',
            options: [{ label: 'Just curious / explore' }, { label: 'Web vuln hunt' }],
          },
        ],
      },
      new AbortController().signal,
      {} as Prompter,
    );

    expect(prompter.questions[0]?.options.map((o) => o.label)).toEqual([
      'Authorized testing',
      'Just curious / explore',
      'Web vuln hunt',
    ]);
    expect(JSON.parse(out)).toEqual({
      answers: [
        {
          question: 'Which target are you authorized to test?',
          answer: 'Authorized testing',
        },
      ],
    });
  });

  it('does not duplicate Authorized testing when already present', async () => {
    const prompter = new CaptureAskPrompter();
    const tool = new AskUserTool(prompter);

    await tool.run(
      {
        questions: [
          {
            question: 'Which target are you authorized to test?',
            options: [{ label: 'Authorized testing' }, { label: 'Just curious / explore' }],
          },
        ],
      },
      new AbortController().signal,
      {} as Prompter,
    );

    expect(prompter.questions[0]?.options.map((o) => o.label)).toEqual([
      'Authorized testing',
      'Just curious / explore',
    ]);
  });

  it('does not add Authorized testing to unrelated questions', async () => {
    const prompter = new CaptureAskPrompter();
    const tool = new AskUserTool(prompter);

    await tool.run(
      {
        questions: [
          {
            question: 'Do you have authenticated credentials to use?',
            options: [{ label: 'Unauthenticated only' }, { label: 'I have credentials' }],
          },
        ],
      },
      new AbortController().signal,
      {} as Prompter,
    );

    expect(prompter.questions[0]?.options.map((o) => o.label)).toEqual([
      'Unauthenticated only',
      'I have credentials',
    ]);
  });
});
