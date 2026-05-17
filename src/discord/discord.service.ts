import { ConflictException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AlertsService } from '../alerts/alerts.service';
import { UserAlert } from '../entities/user-alert.entity';

export type { UserAlert };

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private readonly logger = new Logger(DiscordService.name);

  constructor(private readonly alertsService: AlertsService) {
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
      c.user.setActivity('updating...');
      await this.registerSlashCommands();
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });
  }

  async sendMessage(channelId: string, message: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId) as TextChannel;
      if (channel && channel instanceof TextChannel) {
        await channel.send(message);
        this.logger.log(`Message sent to channel ID ${channelId}`);
      } else {
        this.logger.error(`Channel with ID ${channelId} is not a text channel.`);
      }
    } catch (error) {
      this.logger.error(`Failed to fetch channel with ID ${channelId}:`, error);
    }
  }

  private async registerSlashCommands(): Promise<void> {
    try {
      const commands = [
        new SlashCommandBuilder()
          .setName('alert-add')
          .setDescription('Add a new whisky alert')
          .addStringOption(option =>
            option
              .setName('type')
              .setDescription('Alert type')
              .setRequired(true)
              .addChoices(
                { name: 'Distillery', value: 'distillery' },
                { name: 'Region', value: 'region' },
                { name: 'Age', value: 'age' },
              ),
          )
          .addStringOption(option =>
            option
              .setName('value')
              .setDescription('Alert value (distillery name, region name, or minimum age like "15")')
              .setRequired(true),
          ),
        new SlashCommandBuilder()
          .setName('alert-list')
          .setDescription('List all your active alerts'),
        new SlashCommandBuilder()
          .setName('alert-remove')
          .setDescription('Remove an alert by ID')
          .addIntegerOption(option =>
            option.setName('id').setDescription('Alert ID to remove').setRequired(true),
          ),
      ].map(command => command.toJSON());

      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN || '');

      this.logger.log('Registering slash commands...');
      if (!this.client.user) {
        this.logger.error('Client user is not available');
        return;
      }
      await rest.put(Routes.applicationCommands(this.client.user.id), { body: commands });
      this.logger.log('Slash commands registered successfully');
    } catch (error) {
      this.logger.error('Error registering slash commands:', error);
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (interaction.commandName === 'alert-add') {
        await this.handleAlertAdd(interaction);
      } else if (interaction.commandName === 'alert-list') {
        await this.handleAlertList(interaction);
      } else if (interaction.commandName === 'alert-remove') {
        await this.handleAlertRemove(interaction);
      }
    } catch (error) {
      this.logger.error('Error handling slash command:', error);
      if (!interaction.replied) {
        await interaction.reply({
          content: 'An error occurred while processing your command.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  private async handleAlertAdd(interaction: ChatInputCommandInteraction): Promise<void> {
    const alertType = interaction.options.getString('type', true);
    const rawValue = interaction.options.getString('value', true);

    let alertValue: string;
    try {
      alertValue = this.alertsService.normalizeValue(alertType, rawValue);
    } catch {
      await interaction.reply({ content: '❌ Age must be a positive number.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const saved = await this.alertsService.create(
        interaction.user.id,
        alertType,
        rawValue,
        interaction.guildId ?? undefined,
      );

      const typeLabel = alertType === 'age'
        ? `Age over ${alertValue} years`
        : `${alertType.charAt(0).toUpperCase() + alertType.slice(1)}: ${alertValue}`;

      await interaction.reply({
        content: `✅ Alert added successfully!\n**Type:** ${typeLabel}\n**ID:** ${saved.id}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: any) {
      if (error instanceof ConflictException) {
        await interaction.reply({ content: '⚠️ You already have this alert registered.', flags: MessageFlags.Ephemeral });
        return;
      }
      this.logger.error('Error adding alert:', error);
      await interaction.reply({ content: '❌ Failed to add alert. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }

  private async handleAlertList(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const alerts = await this.alertsService.findByUser(interaction.user.id);

      if (alerts.length === 0) {
        await interaction.reply({ content: '📭 You don\'t have any active alerts.', flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🔔 Your Active Alerts')
        .setColor(0x5865F2)
        .setDescription(
          alerts.map(alert => {
            const typeLabel = alert.alertType === 'age'
              ? `Age over ${alert.alertValue} years`
              : `${alert.alertType.charAt(0).toUpperCase() + alert.alertType.slice(1)}: ${alert.alertValue}`;
            return `**ID ${alert.id}:** ${typeLabel}`;
          }).join('\n'),
        )
        .setFooter({ text: 'Use /alert-remove [id] to remove an alert' });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error('Error listing alerts:', error);
      await interaction.reply({ content: '❌ Failed to list alerts. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }

  private async handleAlertRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    const alertId = interaction.options.getInteger('id', true);

    try {
      await this.alertsService.remove(alertId, interaction.user.id);
      await interaction.reply({ content: `✅ Alert #${alertId} removed successfully!`, flags: MessageFlags.Ephemeral });
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        await interaction.reply({
          content: '❌ Alert not found or you don\'t have permission to remove it.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      this.logger.error('Error removing alert:', error);
      await interaction.reply({ content: '❌ Failed to remove alert. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }

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
    try {
      const embed = new EmbedBuilder()
        .setTitle('🎉 Whisky Alert Match!')
        .setColor(0x00ff00)
        .setDescription('A new whisky matching your alert has been found!')
        .addFields(
          { name: '🥃 Whisky', value: whiskyData.name, inline: false },
          { name: '🏭 Distillery', value: whiskyData.distillery || 'Unknown', inline: true },
          { name: '🌍 Region', value: whiskyData.region || 'Unknown', inline: true },
          { name: '📅 Age', value: whiskyData.age || 'N/A', inline: true },
          { name: '💰 Price', value: whiskyData.price || 'N/A', inline: true },
          { name: '🔥 ABV', value: whiskyData.abv || 'N/A', inline: true },
          { name: '🔗 Link', value: `[View Product](${whiskyData.url})`, inline: false },
        )
        .setFooter({ text: `Matched your ${matchedAlertType} alert: ${matchedAlertValue}` })
        .setTimestamp();

      if (guildId) {
        const guild = await this.client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        if (!member) {
          this.logger.warn(`User ${userId} not found in guild ${guildId}`);
          return;
        }
        await member.send({ embeds: [embed] });
      } else {
        const user = await this.client.users.fetch(userId);
        await user.send({ embeds: [embed] });
      }

      this.logger.log(`Alert notification sent to user ${userId} for whisky ${whiskyData.name}`);
    } catch (error) {
      this.logger.error(`Failed to send alert notification to user ${userId}:`, error);
    }
  }

  async getAllAlerts(): Promise<UserAlert[]> {
    return this.alertsService.getAll();
  }
}
