import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client, GatewayIntentBits, TextChannel, Events } from 'discord.js';

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private readonly logger = new Logger(DiscordService.name);

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
      ],
    });
  }

  async onModuleInit() {
      await this.client.login(process.env.DISCORD_BOT_TOKEN);

      this.client.once(Events.ClientReady, async (c) => {
        this.logger.log(`Discord Bot logged in as ${c.user.tag}`);
        c.user.setActivity('updating...');
      });
  }

  async sendMessage(channelId: string, message: string): Promise<void> {
      try {
        const channel = await this.client.channels.fetch(channelId) as TextChannel;
        
        if (channel && (channel instanceof TextChannel)) {
          await channel.send(message);
          this.logger.log(`Message sent to channel ID ${channelId}`);
        } else {
          this.logger.error(`Channel with ID ${channelId} is not a text channel.`);
        }
    } catch (error) {
      this.logger.error(`Failed to fetch channel with ID ${channelId}:`, error);
    }
  }
}