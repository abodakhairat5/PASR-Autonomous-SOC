import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export interface SecretInputRequest {
  header: string;
  question: string;
  placeholder?: string;
  resolve: (value: string) => void;
  reject: (err: Error) => void;
}

export function SecretInputModal({ req }: { req: SecretInputRequest }): React.ReactElement {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      req.reject(new Error('cancelled'));
      return;
    }
    if (key.return) {
      req.resolve(value.trim());
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input) {
      setValue((v) => v + input.replace(/\r?\n/g, ''));
    }
  });

  const masked = maskSecret(value);
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
        [{req.header}]
      </Text>
      <Text color="white" bold>
        {req.question}
      </Text>
      <Box marginTop={1}>
        <Text color={value ? 'white' : 'gray'}>{value ? masked : req.placeholder || ''}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">type key · Enter test · Esc cancel</Text>
      </Box>
    </Box>
  );
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
