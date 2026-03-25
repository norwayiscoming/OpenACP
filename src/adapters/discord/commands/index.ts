import { SlashCommandBuilder } from 'discord.js'
import type { Guild } from 'discord.js'

export const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('new')
    .setDescription('Create a new agent session')
    .addStringOption((o) => o.setName('agent').setDescription('Agent to use').setRequired(false))
    .addStringOption((o) => o.setName('workspace').setDescription('Workspace directory').setRequired(false)),

  new SlashCommandBuilder()
    .setName('newchat')
    .setDescription('New chat in current thread, inheriting agent and workspace'),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel the current session'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show session or global status'),

  new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('List all sessions'),

  new SlashCommandBuilder()
    .setName('agents')
    .setDescription('List available agents'),

  new SlashCommandBuilder()
    .setName('install')
    .setDescription('Install an agent by name')
    .addStringOption((o) => o.setName('name').setDescription('Agent name to install').setRequired(true)),

  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Show the action menu'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help'),

  new SlashCommandBuilder()
    .setName('dangerous')
    .setDescription('Toggle dangerous mode for the current session'),

  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart OpenACP'),

  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Update to the latest version'),

  new SlashCommandBuilder()
    .setName('integrate')
    .setDescription('Manage agent integrations'),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Show configuration settings'),

  new SlashCommandBuilder()
    .setName('doctor')
    .setDescription('Run system diagnostics'),

  new SlashCommandBuilder()
    .setName('handoff')
    .setDescription('Generate a terminal resume command for this session'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Reset the assistant session'),

  new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Toggle Text to Speech for the current session')
    .addStringOption((o) =>
      o.setName('mode')
        .setDescription('on = persistent, off = disable, empty = next message only')
        .setRequired(false)
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ),
    ),
]

export async function registerSlashCommands(guild: Guild): Promise<void> {
  await guild.commands.set(SLASH_COMMANDS.map((cmd) => cmd.toJSON()))
}

export { handleSlashCommand, setupButtonCallbacks } from './router.js'
