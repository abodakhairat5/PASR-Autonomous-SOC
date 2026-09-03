// One-time first-launch picker. Asks which tooling profile the agent
// should reach for and persists the answer to config. After the user
// picks, this component calls onPick(value) and the CLI bootstrap
// unmounts it + mounts the main TUI.
//
// Uses the borderless typeahead style of the slash + @file
// menus (dim+bright selection, no rounded box), plus a short opening
// header so first-time users know what they're being asked.

import { Box, Text, useApp, useInput } from 'ink';
import { useState } from 'react';
import type { ToolingProfile } from '../config/config.js';

interface ProfileOption {
  value: ToolingProfile;
  label: string;
  description: string;
  helper: string;
}

const OPTIONS: ProfileOption[] = [
  {
    value: 'minimal',
    label: 'curl + Unix tools only  (recommended)',
    description: 'curl + jq, grep, awk, sed, head, sort, uniq',
    helper:
      "The agent stays inside reproducible one-liners. Every probe drops straight into a bug-bounty report. It won't reach for ffuf / nuclei / sqlmap on its own.",
  },
  {
    value: 'full',
    label: 'curl + Unix + specialized scanners',
    description: 'adds ffuf, nuclei, sqlmap, gobuster, subfinder, httpx, wfuzz, masscan',
    helper:
      'The agent may pick a specialized scanner when it judges the workload (large fuzz, CVE template sweep). You still approve each run via the permission modal — scanners are only invoked when locally installed.',
  },
];

export interface FirstRunPickerProps {
  onPick: (profile: ToolingProfile) => void;
  onCancel: () => void;
}

export function FirstRunPicker({ onPick, onCancel }: FirstRunPickerProps): JSX.Element {
  const [idx, setIdx] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      exit();
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % OPTIONS.length);
      return;
    }
    if (key.return) {
      const picked = OPTIONS[idx];
      if (picked) onPick(picked.value);
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="magenta">
        pentesterflow first-run setup
      </Text>
      <Box marginTop={1}>
        <Text>Which tooling should the agent reach for?</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {OPTIONS.map((o, i) => {
          const isSelected = i === idx;
          return (
            <Box key={o.value} flexDirection="column" marginBottom={1}>
              <Box>
                <Text
                  color={isSelected ? 'magenta' : undefined}
                  bold={isSelected}
                  dimColor={!isSelected}
                >
                  {`  ${o.label}`}
                </Text>
              </Box>
              <Box>
                <Text dimColor>{`    ${o.description}`}</Text>
              </Box>
              <Box>
                <Text dimColor>{`    ${o.helper}`}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box>
        <Text dimColor>↑↓ select · Enter pick · Esc cancel · changeable later via config</Text>
      </Box>
    </Box>
  );
}
