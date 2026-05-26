import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  Events,
  REST,
  Routes,
} from 'discord.js';

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private readonly logger = new Logger(DiscordService.name);

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async onModuleInit() {
    await this.client.login(process.env.DISCORD_BOT_TOKEN);

    this.client.once(Events.ClientReady, async (c) => {
      this.logger.log(`Discord Bot logged in as ${c.user.tag}`);
      c.user.setActivity('standing by');
      // Clear any previously registered slash commands
      await this.clearSlashCommands();
    });
  }

  /** Clears all global slash commands registered to this application. */
  private async clearSlashCommands(): Promise<void> {
    try {
      if (!this.client.user) return;
      const rest = new REST({ version: '10' }).setToken(
        process.env.DISCORD_BOT_TOKEN || '',
      );
      await rest.put(Routes.applicationCommands(this.client.user.id), {
        body: [],
      });
      this.logger.log('Slash commands cleared');
    } catch (error) {
      this.logger.error('Error clearing slash commands:', error);
    }
  }

  async sendMessage(channelId: string, message: string): Promise<void> {
    try {
      const channel = (await this.client.channels.fetch(
        channelId,
      )) as TextChannel;
      if (channel && channel instanceof TextChannel) {
        await channel.send(message);
        this.logger.log(`Message sent to channel ID ${channelId}`);
      } else {
        this.logger.error(
          `Channel with ID ${channelId} is not a text channel.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to fetch channel with ID ${channelId}:`,
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Dormant — kept for future use
  // ---------------------------------------------------------------------------

  /*
  async sendAlertNotification(
    userId: string,
    guildId: string | null,
    whiskyData: {
      name: string;
      distillery?: string;
      region?: string;
      age?: string;
      price?: string;
      abv?: string;
      url: string;
    },
    matchedAlertType: string,
    matchedAlertValue: string,
  ): Promise<void> {
    // Re-enable once Discord notifications are needed again.
  }
  */
}
