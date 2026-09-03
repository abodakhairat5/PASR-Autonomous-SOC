// Centered ask-user modal. Arrow keys navigate, Enter picks, Esc cancels.

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { AskRequest } from './askBridge.js';

export function AskModal({ req }: { req: AskRequest }): React.ReactElement {
  const [idx, setIdx] = useState(0);
  const options = req.question.options;

  useInput((input, key) => {
    if (key.escape) {
      req.reject(new Error('cancelled'));
      return;
    }
    if (key.upArrow) {
      setIdx((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setIdx((i) => (i + 1) % options.length);
      return;
    }
    if (key.return) {
      const picked = options[idx];
      if (picked) req.resolve(picked.label);
      return;
    }
    if (input >= '1' && input <= '9') {
      const n = Number.parseInt(input, 10) - 1;
      if (n < options.length) setIdx(n);
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      {req.question.header ? (
        <Text color="cyan" bold>
          [{req.question.header}]
        </Text>
      ) : null}
      <Text color="white" bold>
        {req.question.question}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((o, i) => {
          const selected = i === idx;
          return (
            <Text key={o.label} color={selected ? 'cyan' : 'white'}>
              {selected ? '› ' : '  '}
              {o.label}
              {o.description ? <Text color="gray"> — {o.description}</Text> : null}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑↓ select · Enter pick · Esc cancel</Text>
      </Box>
    </Box>
  );
}
