import { describe, expect, it } from 'vitest';
import { ThinkingStreamFilter, stripThinkingTags } from './sanitize.js';

describe('stripThinkingTags', () => {
  it('removes complete think blocks', () => {
    expect(stripThinkingTags('<think>reasoning</think>\nAnswer')).toBe('Answer');
  });

  it('removes dangling closing think tags from local model output', () => {
    expect(stripThinkingTags('</think>\nAnswer')).toBe('Answer');
  });

  it('keeps trailing text after an unterminated think tag (does not blank the turn)', () => {
    // H7: an unclosed <think> means we can't tell where reasoning ends, so we
    // strip only the tag and preserve the text rather than erasing the whole
    // message (which previously blanked the turn / tripped the compaction breaker).
    expect(stripThinkingTags('<think>reasoning that never closed')).toBe(
      'reasoning that never closed',
    );
    expect(stripThinkingTags('<think>reasoning ... and the answer here')).toBe(
      'reasoning ... and the answer here',
    );
  });

  it('balances nested think blocks and leaves no stray closing tag', () => {
    // M14: peel nested pairs from the inside out; no leaked inner content or
    // dangling </think>.
    expect(stripThinkingTags('<think>a<think>b</think>visible</think>real')).toBe('real');
  });

  it('strips the <thinking> and <reasoning> variants', () => {
    expect(stripThinkingTags('<thinking>plan</thinking>\nAnswer')).toBe('Answer');
    expect(stripThinkingTags('<reasoning>why</reasoning>\nAnswer')).toBe('Answer');
  });

  it("strips Kimi's ◁think▷ unicode delimiters", () => {
    expect(stripThinkingTags('◁think▷deliberating◁/think▷\nAnswer')).toBe('Answer');
    // Lone Kimi close tag (no opener) is dropped, surrounding text kept.
    expect(stripThinkingTags('◁/think▷Answer')).toBe('Answer');
  });
});

describe('ThinkingStreamFilter', () => {
  /** Feed each chunk and concatenate everything the filter chose to emit. */
  const run = (chunks: string[]): string => {
    const f = new ThinkingStreamFilter();
    let out = '';
    for (const c of chunks) out += f.push(c);
    out += f.flush();
    return out;
  };

  it('passes plain text through untouched', () => {
    expect(run(['hello ', 'world'])).toBe('hello world');
  });

  it('suppresses a complete think block within a single chunk', () => {
    expect(run(['<think>secret</think>answer'])).toBe('answer');
  });

  it('suppresses thinking when the tags are split across chunk boundaries', () => {
    // Each tag is fragmented so neither open nor close lands whole in one chunk.
    expect(run(['<thi', 'nk>sec', 'ret</thi', 'nk>ans', 'wer'])).toBe('answer');
  });

  it('keeps text before and after a block, dropping only the reasoning', () => {
    expect(run(['before ', '<think>hidden', '</think> after'])).toBe('before after');
  });

  it('drops a lone close tag streamed without an opener (DeepSeek-R1)', () => {
    // Reasoning streamed first, then </think>, then the answer — no opener.
    expect(run(['reasoning text', '</think>', 'the answer'])).toBe('reasoning textthe answer');
  });

  it('handles the <thinking>, <reasoning>, and Kimi variants in the stream', () => {
    expect(run(['<thinking>x</thinking>a'])).toBe('a');
    expect(run(['<reasoning>x</reasoning>a'])).toBe('a');
    expect(run(['◁think▷x◁/think▷a'])).toBe('a');
  });

  it('drops content still inside an unterminated block at flush', () => {
    // An open block that never closes: its content is reasoning and is dropped.
    expect(run(['answer ', '<think>never closes'])).toBe('answer ');
  });

  it('emits a partial tag as text when the stream ends mid-tag', () => {
    // A dangling partial OPEN tag outside a block is real content (mirrors
    // stripThinkingTags keeping an unterminated tag's text rather than blanking).
    expect(run(['answer <thi'])).toBe('answer <thi');
  });
});
