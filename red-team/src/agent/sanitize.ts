// Strip model "thinking" blocks from output. Some local models emit visible
// reasoning that isn't meant for the end user. We recognize four families:
//   <think>…</think>          (Qwen, GLM, many GGUF chat templates)
//   <thinking>…</thinking>    (Claude-style transcripts replayed locally)
//   <reasoning>…</reasoning>  (assorted fine-tunes)
//   ◁think▷…◁/think▷          (Kimi's unicode delimiters)
// stripThinkingTags() cleans a complete string (used on the final assistant
// text + compaction summaries); ThinkingStreamFilter does the same job
// incrementally over streamed deltas, where a tag can straddle a chunk
// boundary and must be held back until it can be disambiguated.

// Innermost matched pair: the body may not contain another opening tag, so
// repeated application peels nested blocks from the inside out. `\s*` mops up
// whitespace left where the block was. The open/close alternations cover every
// recognized variant, so a `<thinking>` pair (or Kimi's ◁think▷) is peeled the
// same way a `<think>` pair is.
const THINK_PAIR_RE =
  /(?:<(?:think|thinking|reasoning)>|◁think▷)(?:(?!<(?:think|thinking|reasoning)>|◁think▷)[\s\S])*?(?:<\/(?:think|thinking|reasoning)>|◁\/think▷)\s*/i;
// Leftover lone tags after all pairs are gone (an unclosed open tag or a stray
// close tag). We drop only the tag and keep the surrounding text.
const LONE_THINK_TAG_RE = /<\/?(?:think|thinking|reasoning)>|◁\/?think▷/gi;
// Cheap pre-check so the common no-reasoning path returns untouched.
const ANY_THINK_TAG_RE = /<\/?(?:think|thinking|reasoning)>|◁\/?think▷/i;

/**
 * Remove reasoning blocks while preserving real answer text. Only *matched*
 * open/close pairs are deleted (handles nesting). An UNCLOSED open tag has just
 * its tag removed — the trailing text is kept, so a truncated/streamed cutoff
 * or an answer emitted inside an unterminated block is never erased wholesale
 * (which previously blanked the turn and could trip the compaction circuit
 * breaker).
 */
export function stripThinkingTags(s: string): string {
  if (!ANY_THINK_TAG_RE.test(s)) return s;
  let out = s;
  let prev: string;
  do {
    prev = out;
    out = out.replace(THINK_PAIR_RE, '');
  } while (out !== prev);
  return out.replace(LONE_THINK_TAG_RE, '').trimStart();
}

// Tag tokens for the incremental filter, lowercased so we can scan a lowercased
// copy of the buffer (the unicode triangles are case-stable, ASCII letters fold
// without changing length, so indices line up with the original text).
const THINK_OPEN_TAGS = ['<think>', '<thinking>', '<reasoning>', '◁think▷'] as const;
const THINK_CLOSE_TAGS = ['</think>', '</thinking>', '</reasoning>', '◁/think▷'] as const;
const ALL_THINK_TAGS = [...THINK_OPEN_TAGS, ...THINK_CLOSE_TAGS] as const;

/** Earliest position of any of `tags` in `s` (case-insensitive), or index -1. */
function findFirstTag(s: string, tags: readonly string[]): { index: number; length: number } {
  const lower = s.toLowerCase();
  let index = -1;
  let length = 0;
  for (const tag of tags) {
    const i = lower.indexOf(tag);
    if (i >= 0 && (index < 0 || i < index)) {
      index = i;
      length = tag.length;
    }
  }
  return { index, length };
}

/**
 * Length of the prefix of `s` that is safe to act on now because no suffix of
 * it could be the *start* of one of `tags` split across the next chunk. We hold
 * back the longest suffix of `s` that equals a proper prefix of some tag.
 */
function safePrefixLength(s: string, tags: readonly string[]): number {
  const lower = s.toLowerCase();
  let hold = 0;
  for (const tag of tags) {
    const max = Math.min(tag.length - 1, lower.length);
    for (let p = max; p > hold; p -= 1) {
      if (lower.endsWith(tag.slice(0, p))) {
        hold = p;
        break;
      }
    }
  }
  return s.length - hold;
}

/**
 * Stateful incremental filter that suppresses thinking-block content from a
 * stream of text chunks, so a model's `<think>…</think>` reasoning never
 * reaches the UI live. push() returns only the text safe to display so far;
 * any suffix that might be the leading edge of a split tag is buffered until
 * the next chunk disambiguates it. A lone close tag (DeepSeek-R1 streams its
 * reasoning then `</think>` then the answer, with no opener) is dropped like
 * stripThinkingTags drops stray tags — the surrounding text is kept. Call
 * flush() once at stream end to release any buffered tail.
 */
export class ThinkingStreamFilter {
  private inThinking = false;
  private pending = '';

  push(chunk: string): string {
    if (!chunk) return '';
    this.pending += chunk;
    let out = '';
    while (this.pending.length > 0) {
      if (this.inThinking) {
        const close = findFirstTag(this.pending, THINK_CLOSE_TAGS);
        if (close.index < 0) {
          // Still inside the block: discard everything that can't be the start
          // of a split close tag; hold the rest for the next chunk.
          this.pending = this.pending.slice(safePrefixLength(this.pending, THINK_CLOSE_TAGS));
          break;
        }
        // Drop the reasoning body + the close tag and the whitespace it left.
        this.pending = this.pending.slice(close.index + close.length).replace(/^\s+/, '');
        this.inThinking = false;
        continue;
      }
      const open = findFirstTag(this.pending, THINK_OPEN_TAGS);
      const close = findFirstTag(this.pending, THINK_CLOSE_TAGS);
      // Whichever recognized tag comes first decides what happens next: an open
      // tag enters a block, a lone close tag is just dropped.
      const openFirst = open.index >= 0 && (close.index < 0 || open.index <= close.index);
      const next = openFirst ? open : close;
      if (next.index < 0) {
        const safe = safePrefixLength(this.pending, ALL_THINK_TAGS);
        out += this.pending.slice(0, safe);
        this.pending = this.pending.slice(safe);
        break;
      }
      out += this.pending.slice(0, next.index);
      this.pending = this.pending.slice(next.index + next.length);
      if (openFirst) this.inThinking = true;
      else this.pending = this.pending.replace(/^\s+/, '');
    }
    return out;
  }

  /**
   * Release any held-back text at stream end. A partial/unclosed tag outside a
   * block is real content and is emitted (mirroring stripThinkingTags keeping
   * an unterminated tag's trailing text); anything still inside an open block
   * is reasoning and is dropped.
   */
  flush(): string {
    const out = this.inThinking ? '' : this.pending;
    this.pending = '';
    this.inThinking = false;
    return out;
  }
}
