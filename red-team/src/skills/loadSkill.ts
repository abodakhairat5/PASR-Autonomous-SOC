import type { Prompter } from '../permission/permission.js';
import type { Tool } from '../tools/types.js';
import { type Registry, materializeSkillBody } from './registry.js';

export class LoadSkillTool implements Tool {
  private readonly reg: Registry;

  constructor(reg: Registry) {
    this.reg = reg;
  }

  name(): string {
    return 'load_skill';
  }

  description(): string {
    return "Load the full body of a named skill. Skills are pre-authored playbooks for specific pentesting workflows (recon, web vuln hunting, etc.). Call this when one of the listed skills matches the user's task — the body contains step-by-step guidance, recommended tools, and example commands.";
  }

  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Skill name (matches the 'name' field listed in the system prompt).",
        },
      },
      required: ['name'],
    };
  }

  requiresPermission(): boolean {
    return false;
  }

  async run(args: Record<string, unknown>, _signal: AbortSignal, _p: Prompter): Promise<string> {
    const nm = typeof args.name === 'string' ? args.name : '';
    if (!nm) throw new Error('name is required');
    const s = this.reg.get(nm);
    if (!s) {
      const names = this.reg
        .listEnabled()
        .filter((sk) => !sk.disableModelInvocation)
        .map((sk) => sk.name)
        .join(', ');
      throw new Error(`unknown skill "${nm}". Available: ${names}`);
    }
    if (this.reg.isDisabled(nm)) {
      throw new Error(
        `skill "${nm}" is disabled. The user must enable it via /skills enable ${nm} before it can be loaded.`,
      );
    }
    if (s.disableModelInvocation) {
      throw new Error(
        `skill "${nm}" is marked disable-model-invocation: true. Only the user can load it via /${nm}.`,
      );
    }
    return materializeSkillBody(s);
  }
}
