// Tool registry.: register tools by
// name, expose them as LLM function-call specs, execute with permission
// gating.

import type { ToolSpec } from '../llm/types.js';
import type { Prompter } from '../permission/permission.js';
import type { Tool } from './types.js';

export class Registry {
  private tools = new Map<string, Tool>();

  register(t: Tool): void {
    this.tools.set(t.name(), t);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  /** Render the registry as the `tools` array sent to the model. */
  asLLMTools(): ToolSpec[] {
    return Array.from(this.tools.values()).map((t) => ({
      type: 'function',
      function: {
        name: t.name(),
        description: t.description(),
        parameters: t.schema(),
      },
    }));
  }

  /**
   * Look up a tool by name, prompt for permission if needed, then run it.
   * Returns the tool's string result; throws on unknown tool, denied
   * permission, or any error from the tool itself.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    prompter: Prompter,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`unknown tool: ${name}`);
    }
    if (tool.requiresPermission()) {
      const { summary, detail } = summarize(tool, args);
      const hints = tool.permissionHints?.(args) ?? {};
      const decision = await prompter.ask({ tool: tool.name(), summary, detail, ...hints }, signal);
      if (decision === 'deny') {
        throw new Error(`permission denied by user for ${tool.name()}`);
      }
    }
    return tool.run(args, signal, prompter);
  }
}

function summarize(t: Tool, args: Record<string, unknown>): { summary: string; detail: string } {
  if (t.summarize) return t.summarize(args);
  return { summary: t.name(), detail: JSON.stringify(args) };
}
