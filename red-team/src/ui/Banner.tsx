// Banner: rounded box with PF logo on the left and labeled connection
// metadata right-aligned. Width is the
// terminal width; the box stretches edge-to-edge.

import { Box, Text } from 'ink';

const LOGO = ['█▀█ █▀▀', '█▀▀ █▀ ', '▀   ▀  '];

export type ToolSupportPill = 'yes' | 'no' | 'unknown' | 'probing';

export interface BannerData {
  provider: string;
  model: string;
  endpoint?: string;
  state?: string; // "local" / "remote"
  status?: string;
  cwd: string;
  /** Result of the startup tool-calling probe — drives the Model-line pill. */
  toolSupport?: ToolSupportPill;
  /** Effective context window (e.g. Ollama num_ctx) shown next to Model. */
  contextWindow?: number;
}

function modelPill(t?: ToolSupportPill): { text: string; color: string } | null {
  switch (t) {
    case 'yes':
      return { text: 'tools ✓', color: 'green' };
    case 'no':
      return { text: 'NO TOOLS', color: 'red' };
    case 'probing':
      return { text: 'probing…', color: 'yellow' };
    case 'unknown':
      return { text: 'tools ?', color: 'gray' };
    default:
      return null;
  }
}

export function Banner({ data, width }: { data: BannerData; width?: number }): React.ReactElement {
  const pill = modelPill(data.toolSupport);
  const ctx = data.contextWindow ? ` · ctx ${data.contextWindow}` : '';
  const modelValue = `${data.model}${ctx}`;
  const boxWidth = Math.max(20, width ?? 80);
  const labels: Array<{
    label: string;
    value: string;
    accent?: boolean;
    hint?: boolean;
    pill?: { text: string; color: string } | null;
  }> = [
    { label: 'Welcome to pentesterflow', value: '', accent: true },
    { label: 'Provider', value: data.state ? `${data.provider} (${data.state})` : data.provider },
    { label: 'Model', value: modelValue, pill },
    ...(data.endpoint ? [{ label: 'Endpoint', value: data.endpoint }] : []),
    { label: 'Path', value: data.cwd },
    ...(data.status ? [{ label: 'Status', value: data.status, hint: true }] : []),
  ];

  // Vertical-center the logo against the labels.
  const padTop = Math.max(0, Math.floor((labels.length - LOGO.length) / 2));
  const padBot = Math.max(0, labels.length - LOGO.length - padTop);
  const logoRows = [...Array(padTop).fill(''), ...LOGO, ...Array(padBot).fill('')];

  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
      flexDirection="column"
      paddingX={1}
      width={boxWidth}
      flexShrink={0}
    >
      {labels.map((row, i) => {
        const logoCell = logoRows[i] ?? '';
        return (
          <Box key={`${row.label}-${i}`} width="100%" justifyContent="space-between">
            <Box width={8} flexShrink={0}>
              <Text color="magenta" wrap="truncate">
                {logoCell}
              </Text>
            </Box>
            {row.accent ? (
              <Box flexShrink={1} justifyContent="flex-end">
                <Text color="magenta" bold wrap="truncate">
                  {row.label}
                </Text>
              </Box>
            ) : (
              <Box flexShrink={1} justifyContent="flex-end">
                <Text color="magenta">{row.label}: </Text>
                <Text color={row.hint ? 'gray' : 'white'} wrap="truncate">
                  {row.value}
                </Text>
                {row.pill ? (
                  <Text color={row.pill.color} wrap="truncate">
                    {' '}
                    [{row.pill.text}]
                  </Text>
                ) : null}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
