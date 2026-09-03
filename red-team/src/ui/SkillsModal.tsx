// Interactive /skills picker. Renders the full skill list with the
// current on/off state; ↑/↓ navigate, space or Enter toggle the
// highlighted skill (the picker stays open so the user can flip several
// in one session), Esc closes.
//
// Source of truth for state is the live registry on the agent. Each
// toggle goes through agent.setSkillEnabled (which rebuilds the system
// prompt) and the optional persistDisabledSkills callback (which writes
// ~/.pentesterflow/config.json). We force a re-render by bumping a local
// tick counter so the read of registry.list() / isDisabled() picks up
// the new state.

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Agent } from '../agent/agent.js';
import type { PersistDisabledSkills } from './App.js';

export interface SkillsModalProps {
  agent: Agent;
  persistDisabledSkills?: PersistDisabledSkills;
  onClose: () => void;
}

export function SkillsModal({
  agent,
  persistDisabledSkills,
  onClose,
}: SkillsModalProps): React.ReactElement {
  const [idx, setIdx] = useState(0);
  // Bump after every toggle so React re-reads the registry. We deliberately
  // *don't* memoize the list — the registry mutates in place and the
  // picker is short-lived, so a fresh read on each render is fine.
  const [, setTick] = useState(0);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const skills = agent.skills.list();
  const total = skills.length;
  const safeIdx = total > 0 ? Math.min(idx, total - 1) : 0;
  const current = skills[safeIdx];

  const toggle = async (): Promise<void> => {
    if (!current || busyName) return;
    const targetEnabled = agent.skills.isDisabled(current.name);
    setBusyName(current.name);
    setError(null);
    try {
      const changed = await agent.setSkillEnabled(current.name, targetEnabled);
      if (changed && persistDisabledSkills) {
        await persistDisabledSkills(agent.skills.disabledNames());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
      setTick((t) => t + 1);
    }
  };

  const toggleAll = async (enabled: boolean): Promise<void> => {
    if (busyName) return;
    setBusyName('*');
    setError(null);
    try {
      for (const s of skills) {
        if (agent.skills.isDisabled(s.name) === !enabled) continue; // already in state
        await agent.setSkillEnabled(s.name, enabled);
      }
      if (persistDisabledSkills) {
        await persistDisabledSkills(agent.skills.disabledNames());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
      setTick((t) => t + 1);
    }
  };

  useInput((rawInput, key) => {
    if (busyName) return; // ignore while a toggle is in flight
    if (key.escape || rawInput === 'q') {
      onClose();
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + Math.max(1, total)) % Math.max(1, total));
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % Math.max(1, total));
      return;
    }
    if (key.return || rawInput === ' ') {
      void toggle();
      return;
    }
    if (rawInput === 'a') {
      void toggleAll(true);
      return;
    }
    if (rawInput === 'd') {
      void toggleAll(false);
      return;
    }
    // Number keys jump directly to that entry.
    if (rawInput >= '1' && rawInput <= '9') {
      const n = Number.parseInt(rawInput, 10) - 1;
      if (n < total) setIdx(n);
    }
  });

  if (total === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        marginTop={1}
      >
        <Text color="cyan" bold>
          [skills]
        </Text>
        <Text color="white">No skills are loaded.</Text>
        <Box marginTop={1}>
          <Text color="gray">Esc · q to close</Text>
        </Box>
      </Box>
    );
  }

  const enabledCount = skills.filter((s) => !agent.skills.isDisabled(s.name)).length;

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          [skills]
        </Text>
        <Text color="gray">
          {enabledCount}/{total} enabled
        </Text>
      </Box>
      <Text color="white" bold>
        Toggle skills available to the agent
      </Text>
      <Box marginTop={1} flexDirection="column">
        {skills.map((s, i) => {
          const selected = i === safeIdx;
          const disabled = agent.skills.isDisabled(s.name);
          const busy = busyName === s.name || busyName === '*';
          const stateLabel = busy ? '…    ' : disabled ? '[off]' : '[on] ';
          const stateColor = busy ? 'yellow' : disabled ? 'gray' : 'green';
          return (
            <Box key={s.name}>
              <Text color={selected ? 'cyan' : 'white'}>{selected ? '› ' : '  '}</Text>
              <Text color={stateColor}>{stateLabel}</Text>
              <Text color={selected ? 'cyan' : disabled ? 'gray' : 'white'}> {s.name}</Text>
              <Text color="gray"> — {truncate(s.description, 60)}</Text>
            </Box>
          );
        })}
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color="red">error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">
          ↑↓ select · Space/Enter toggle · a enable all · d disable all · Esc/q close
        </Text>
      </Box>
    </Box>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
