// Bridge between the agent's AskPrompter and React state. Same pattern
// as permBridge: pending Question lives in app state; the agent's
// promise resolves when the user picks an option.

import type { AskPrompter, Question } from '../ask/ask.js';

export interface AskRequest {
  question: Question;
  resolve: (label: string) => void;
  reject: (err: Error) => void;
}

export type AskPublisher = (req: AskRequest | null) => void;

export class BridgedAskPrompter implements AskPrompter {
  private publish: AskPublisher;
  constructor(publish: AskPublisher) {
    this.publish = publish;
  }

  async ask(q: Question, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const onAbort = () => {
        this.publish(null);
        reject(new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.publish({
        question: q,
        resolve: (label) => {
          signal?.removeEventListener('abort', onAbort);
          this.publish(null);
          resolve(label);
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          this.publish(null);
          reject(err);
        },
      });
    });
  }
}
