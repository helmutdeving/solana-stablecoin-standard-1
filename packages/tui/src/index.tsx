#!/usr/bin/env node
/**
 * SSS Admin TUI — Interactive terminal UI for stablecoin administration
 *
 * Screens:
 *   1. Dashboard  — live overview of all deployed stablecoins
 *   2. Mint       — mint tokens to a recipient
 *   3. Burn       — burn tokens from an account
 *   4. Whitelist  — add/remove KYC whitelist entries (SSS-2)
 *   5. Allowlist  — manage SSS-3 allowlist
 *   6. Freeze     — freeze/unfreeze accounts (SSS-2)
 *   7. Pause      — toggle global pause (admin)
 *   8. Seize      — seize funds from frozen accounts (SSS-2)
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen =
  | 'dashboard'
  | 'mint'
  | 'burn'
  | 'whitelist'
  | 'allowlist'
  | 'freeze'
  | 'pause'
  | 'seize'
  | 'help';

interface StablecoinInfo {
  mint: string;
  name: string;
  symbol: string;
  preset: 'SSS-1' | 'SSS-2' | 'SSS-3';
  supply: string;
  supplyCap: string;
  paused: boolean;
  decimals: number;
}

interface TuiState {
  screen: Screen;
  loading: boolean;
  status: string;
  selected: StablecoinInfo | null;
  coins: StablecoinInfo[];
  txSignature: string | null;
  error: string | null;
}

// ─── Mock data for demo (replace with real SDK calls in production) ──────────

const MOCK_COINS: StablecoinInfo[] = [
  {
    mint: 'So11111111111111111111111111111111111111112',
    name: 'Test USD',
    symbol: 'tUSD',
    preset: 'SSS-1',
    supply: '1,000,000.00',
    supplyCap: '10,000,000.00',
    paused: false,
    decimals: 6,
  },
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    name: 'Test Euro',
    symbol: 'tEUR',
    preset: 'SSS-2',
    supply: '500,000.00',
    supplyCap: '5,000,000.00',
    paused: false,
    decimals: 6,
  },
  {
    mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    name: 'Private USD',
    symbol: 'pUSD',
    preset: 'SSS-3',
    supply: '250,000.00',
    supplyCap: '2,500,000.00',
    paused: false,
    decimals: 6,
  },
];

// ─── Components ───────────────────────────────────────────────────────────────

const PRESET_COLORS: Record<string, string> = {
  'SSS-1': 'cyan',
  'SSS-2': 'yellow',
  'SSS-3': 'magenta',
};

const Header = ({ screen }: { screen: Screen }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Box borderStyle="double" borderColor="green" paddingX={2} paddingY={0}>
      <Text color="green" bold>
        ◆ SSS Admin TUI — Solana Stablecoin Standard
      </Text>
    </Box>
    <Box marginTop={0} paddingX={1}>
      <Text color="gray">
        Screen: <Text color="white" bold>{screen.toUpperCase()}</Text>
        {'  '}[Tab] Switch  [Q] Quit  [?] Help
      </Text>
    </Box>
  </Box>
);

const CoinCard = ({
  coin,
  selected,
}: {
  coin: StablecoinInfo;
  selected: boolean;
}) => (
  <Box
    borderStyle={selected ? 'double' : 'single'}
    borderColor={selected ? 'green' : 'gray'}
    paddingX={1}
    marginRight={1}
    flexDirection="column"
    width={28}
  >
    <Box>
      <Text
        color={PRESET_COLORS[coin.preset] as any}
        bold
      >
        [{coin.preset}]
      </Text>
      <Text> </Text>
      <Text bold>{coin.symbol}</Text>
      {coin.paused && <Text color="red"> ⏸ PAUSED</Text>}
    </Box>
    <Text color="gray">{coin.name}</Text>
    <Box marginTop={1}>
      <Text color="white">Supply: </Text>
      <Text color="green">{coin.supply}</Text>
    </Box>
    <Box>
      <Text color="white">Cap:    </Text>
      <Text color="gray">{coin.supplyCap}</Text>
    </Box>
    <Box marginTop={1}>
      <Text color="gray" dimColor>
        {coin.mint.slice(0, 12)}…
      </Text>
    </Box>
  </Box>
);

const Dashboard = ({ state }: { state: TuiState }) => (
  <Box flexDirection="column">
    <Box marginBottom={1}>
      <Text color="white" bold>
        Deployed Stablecoins
      </Text>
    </Box>
    <Box flexDirection="row" flexWrap="wrap">
      {state.coins.map((coin) => (
        <CoinCard
          key={coin.mint}
          coin={coin}
          selected={state.selected?.mint === coin.mint}
        />
      ))}
    </Box>
    {state.selected && (
      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={2}>
        <Text color="green">Selected: </Text>
        <Text bold>{state.selected.symbol}</Text>
        <Text color="gray"> — use Tab to navigate screens</Text>
      </Box>
    )}
  </Box>
);

const ActionScreen = ({
  title,
  description,
  fields,
  loading,
  txSignature,
  error,
}: {
  title: string;
  description: string;
  fields: { label: string; value: string }[];
  loading: boolean;
  txSignature: string | null;
  error: string | null;
}) => (
  <Box flexDirection="column">
    <Box marginBottom={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
    </Box>
    <Text color="gray">{description}</Text>
    <Box marginTop={1} flexDirection="column">
      {fields.map((f) => (
        <Box key={f.label}>
          <Text color="white">{f.label}: </Text>
          <Text color="cyan">{f.value}</Text>
        </Box>
      ))}
    </Box>
    {loading && (
      <Box marginTop={1}>
        <Spinner type="dots" />
        <Text> Sending transaction…</Text>
      </Box>
    )}
    {txSignature && (
      <Box marginTop={1}>
        <Text color="green">✓ TX: </Text>
        <Text color="green">{txSignature}</Text>
      </Box>
    )}
    {error && (
      <Box marginTop={1}>
        <Text color="red">✗ Error: {error}</Text>
      </Box>
    )}
    <Box marginTop={2} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="gray">
        [Enter] Confirm  [Esc] Back  [Tab] Next screen
      </Text>
    </Box>
  </Box>
);

const HelpScreen = () => (
  <Box flexDirection="column">
    <Text color="white" bold>
      Keyboard Shortcuts
    </Text>
    <Box marginTop={1} flexDirection="column">
      {[
        ['Tab / →', 'Next screen'],
        ['Shift+Tab / ←', 'Previous screen'],
        ['↑ / ↓', 'Navigate coins / fields'],
        ['Enter', 'Select / Confirm action'],
        ['Esc', 'Cancel / Back'],
        ['Q', 'Quit TUI'],
        ['?', 'Toggle this help'],
        ['D', 'Jump to Dashboard'],
        ['M', 'Jump to Mint'],
        ['B', 'Jump to Burn'],
        ['W', 'Jump to Whitelist (SSS-2)'],
        ['A', 'Jump to Allowlist (SSS-3)'],
        ['F', 'Jump to Freeze/Unfreeze'],
        ['P', 'Jump to Pause/Unpause'],
        ['S', 'Jump to Seize'],
      ].map(([key, desc]) => (
        <Box key={key}>
          <Box width={20}>
            <Text color="cyan" bold>
              {key}
            </Text>
          </Box>
          <Text color="gray">{desc}</Text>
        </Box>
      ))}
    </Box>
  </Box>
);

const SCREENS: Screen[] = [
  'dashboard',
  'mint',
  'burn',
  'whitelist',
  'allowlist',
  'freeze',
  'pause',
  'seize',
  'help',
];

// ─── Main App ────────────────────────────────────────────────────────────────

const App = () => {
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>({
    screen: 'dashboard',
    loading: false,
    status: 'Ready',
    selected: MOCK_COINS[0] ?? null,
    coins: MOCK_COINS,
    txSignature: null,
    error: null,
  });

  const setScreen = (screen: Screen) =>
    setState((s) => ({ ...s, screen, txSignature: null, error: null }));

  useInput((input, key) => {
    // Quit
    if (input === 'q' || input === 'Q') exit();

    // Help
    if (input === '?') setScreen('help');

    // Quick jump
    if (input === 'd') setScreen('dashboard');
    if (input === 'm') setScreen('mint');
    if (input === 'b') setScreen('burn');
    if (input === 'w') setScreen('whitelist');
    if (input === 'a') setScreen('allowlist');
    if (input === 'f') setScreen('freeze');
    if (input === 'p') setScreen('pause');
    if (input === 's') setScreen('seize');

    // Tab navigation
    if (key.tab) {
      const idx = SCREENS.indexOf(state.screen);
      const next = SCREENS[(idx + 1) % SCREENS.length]!;
      setScreen(next);
    }

    // Arrow coin selection on dashboard
    if (state.screen === 'dashboard') {
      if (key.rightArrow || key.downArrow) {
        const idx = state.coins.findIndex(
          (c) => c.mint === state.selected?.mint
        );
        const next = state.coins[(idx + 1) % state.coins.length];
        if (next) setState((s) => ({ ...s, selected: next }));
      }
      if (key.leftArrow || key.upArrow) {
        const idx = state.coins.findIndex(
          (c) => c.mint === state.selected?.mint
        );
        const prev =
          state.coins[(idx - 1 + state.coins.length) % state.coins.length];
        if (prev) setState((s) => ({ ...s, selected: prev }));
      }
    }
  });

  const renderScreen = () => {
    switch (state.screen) {
      case 'dashboard':
        return <Dashboard state={state} />;

      case 'mint':
        return (
          <ActionScreen
            title="Mint Tokens"
            description="Mint new tokens to a recipient address (requires mint authority)"
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none selected' },
              { label: 'Preset', value: state.selected?.preset ?? '—' },
              { label: 'Recipient', value: '<enter recipient address>' },
              { label: 'Amount', value: '<enter amount>' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'burn':
        return (
          <ActionScreen
            title="Burn Tokens"
            description="Burn tokens from a holder account (requires burn authority)"
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none selected' },
              { label: 'Holder', value: '<enter holder address>' },
              { label: 'Amount', value: '<enter amount>' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'whitelist':
        return (
          <ActionScreen
            title="KYC Whitelist Management (SSS-2)"
            description="Add or remove addresses from the SSS-2 KYC whitelist. Only SSS-2 stablecoins are affected."
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none' },
              { label: 'Preset', value: state.selected?.preset ?? '—' },
              { label: 'Action', value: '<add / remove>' },
              { label: 'Wallet', value: '<enter wallet address>' },
              { label: 'KYC Ref', value: '<enter KYC reference ID>' },
              { label: 'Expiry', value: '<YYYY-MM-DD or 0 for no expiry>' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'allowlist':
        return (
          <ActionScreen
            title="Allowlist Management (SSS-3)"
            description="Manage the SSS-3 access allowlist. Allowlisted addresses can send/receive tokens (configurable)."
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none' },
              { label: 'Preset', value: state.selected?.preset ?? '—' },
              { label: 'Action', value: '<add / remove>' },
              { label: 'Wallet', value: '<enter wallet address>' },
              { label: 'Note', value: '<optional note, e.g. partner name>' },
              { label: 'Expiry', value: '<YYYY-MM-DD or 0 for no expiry>' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'freeze':
        return (
          <ActionScreen
            title="Freeze / Unfreeze Account (SSS-2)"
            description="Freeze an account to halt all transfers. Seize is required to recover funds from frozen accounts."
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none' },
              { label: 'Action', value: '<freeze / unfreeze>' },
              { label: 'Wallet', value: '<enter wallet address>' },
              { label: 'Reason', value: '<enter reason (max 128 chars)>' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'pause':
        return (
          <ActionScreen
            title="Pause / Unpause Stablecoin (Admin)"
            description="Toggle the global pause flag. When paused, all mints, burns, and transfers are blocked."
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none' },
              { label: 'Current Status', value: state.selected?.paused ? '⏸ PAUSED' : '▶ ACTIVE' },
              { label: 'Action', value: state.selected?.paused ? 'Unpause' : 'Pause' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'seize':
        return (
          <ActionScreen
            title="Seize Funds (SSS-2)"
            description="Transfer funds from a frozen account to the compliance vault. Account must be frozen first."
            fields={[
              { label: 'Token', value: state.selected?.symbol ?? 'none' },
              { label: 'Frozen Wallet', value: '<enter frozen wallet address>' },
              { label: 'Amount', value: '<enter amount to seize (or max)>' },
            ]}
            loading={state.loading}
            txSignature={state.txSignature}
            error={state.error}
          />
        );

      case 'help':
        return <HelpScreen />;

      default:
        return <Text>Unknown screen</Text>;
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header screen={state.screen} />
      {renderScreen()}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">
          Status: <Text color={state.error ? 'red' : 'green'}>{state.error ?? state.status}</Text>
        </Text>
      </Box>
    </Box>
  );
};

render(<App />);
