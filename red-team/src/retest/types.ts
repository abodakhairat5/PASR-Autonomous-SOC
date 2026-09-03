export type RetestResult = 'confirmed' | 'not-reproduced' | 'error' | 'blocked-by-policy';

export interface RetestAttempt {
  attemptedAt: string;
  result: RetestResult;
  evidenceId?: string;
  error?: string;
}

export interface RetestState {
  findingId: string;
  lastAttemptAt?: string;
  attempts: number;
  lastResult?: RetestResult;
  history: RetestAttempt[];
}
