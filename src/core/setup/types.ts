export type OnboardSection =
  | "channels"
  | "agents"
  | "workspace"
  | "runMode"
  | "integrations";

export type ConfiguredChannelAction = "modify" | "disable" | "delete" | "skip";

export type ChannelId = string;

export type ChannelStatus = {
  id: ChannelId;
  label: string;
  configured: boolean;
  enabled: boolean;
  hint?: string;
};

export const ONBOARD_SECTION_OPTIONS: Array<{
  value: OnboardSection;
  label: string;
  hint: string;
}> = [
  { value: "channels", label: "Channels", hint: "Link/update messaging platforms" },
  { value: "agents", label: "Agents", hint: "Install agents, change default" },
  { value: "workspace", label: "Workspace", hint: "Set workspace directory" },
  { value: "runMode", label: "Run mode", hint: "Foreground/daemon, auto-start" },
  { value: "integrations", label: "Integrations", hint: "Claude CLI session transfer" },
];

export const CHANNEL_META: Record<string, { label: string; method: string }> = {
  sse: { label: "Desktop App", method: "SSE" },
  telegram: { label: "Telegram", method: "Bot API" },
  discord: { label: "Discord", method: "Bot API" },
};

export interface CommunityAdapterOption {
  name: string           // npm package name, e.g. "@openacp/adapter-slack"
  displayName: string    // e.g. "Slack Adapter"
  icon: string           // e.g. "💬"
  verified: boolean
}

