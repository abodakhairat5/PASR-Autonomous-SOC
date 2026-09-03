// Terminal-size context. A small React context that exposes the
// current terminal dimensions ({columns, rows}) to any component that
// asks for them via useTerminalSize(). The provider subscribes to
// stdout's `resize` event so dimensions stay live as the user resizes
// their terminal window.
//
// Built on Ink's useStdout hook; pentesterflow uses functional
// components throughout.

import { useStdout } from 'ink';
import { createContext, useContext, useEffect, useState } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

const TerminalSizeContext = createContext<TerminalSize | null>(null);

const DEFAULT_SIZE: TerminalSize = { columns: 100, rows: 30 };

/**
 * Wrap the Ink tree in this Provider so any descendant can read the
 * live terminal size with useTerminalSize(). The Provider subscribes
 * to the stdout `resize` event and re-renders consumers when fired.
 */
export function TerminalSizeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => readSize(stdout));

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize(readSize(stdout));
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return <TerminalSizeContext.Provider value={size}>{children}</TerminalSizeContext.Provider>;
}

/** Throws if used outside a TerminalSizeProvider — same contract as the demo. */
export function useTerminalSize(): TerminalSize {
  const size = useContext(TerminalSizeContext);
  if (!size) {
    throw new Error('useTerminalSize must be used inside a TerminalSizeProvider');
  }
  return size;
}

function readSize(stdout: NodeJS.WriteStream | undefined): TerminalSize {
  if (!stdout) return DEFAULT_SIZE;
  return {
    columns: stdout.columns ?? DEFAULT_SIZE.columns,
    rows: stdout.rows ?? DEFAULT_SIZE.rows,
  };
}
