import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { 
  Client, 
  GatewayIntentBits, 
  TextChannel, 
  Events, 
  REST, 
  Routes,
  SlashCommandBuilder,
  CommandInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  User,
  MessageFlags
} from 'discord.js';
import { PostgresService } from '../postgres/postgres.service';

export interface UserAlert {
  id: number;
  user_id: string;
  guild_id: string;
  alert_type: 'distillery' | 'region' | 'age';
  alert_value: string;
  created_at: Date;
}

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private readonly logger = new Logger(DiscordService.name);

  constructor(private readonly postgresService: PostgresService) {
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
        
        // Register slash commands
        await this.registerSlashCommands();
      });

      // Handle slash command interactions
      this.client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        await this.handleSlashCommand(interaction);
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

  /**
   * Register slash commands with Discord
   */
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
                { name: 'Age', value: 'age' }
              )
          )
          .addStringOption(option =>
            option
              .setName('value')
              .setDescription('Alert value (distillery name, region name, or minimum age like "15")')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('alert-list')
          .setDescription('List all your active alerts'),
        new SlashCommandBuilder()
          .setName('alert-remove')
          .setDescription('Remove an alert by ID')
          .addIntegerOption(option =>
            option
              .setName('id')
              .setDescription('Alert ID to remove')
              .setRequired(true)
          ),
      ].map(command => command.toJSON());

      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN || '');

      this.logger.log('Registering slash commands...');
      if (!this.client.user) {
        this.logger.error('Client user is not available');
        return;
      }
      await rest.put(
        Routes.applicationCommands(this.client.user.id),
        { body: commands }
      );
      this.logger.log('Slash commands registered successfully');
    } catch (error) {
      this.logger.error('Error registering slash commands:', error);
    }
  }

  /**
   * Handle slash command interactions
   */
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
          flags: MessageFlags.Ephemeral 
        });
      }
    }
  }

  /**
   * Handle /alert-add command
   */
  private async handleAlertAdd(interaction: ChatInputCommandInteraction): Promise<void> {
    const type = interaction.options.getString('type', true);
    let value = interaction.options.getString('value', true);

    // Validate and normalize value
    if (type === 'age') {
      const ageNum = parseInt(value);
      if (isNaN(ageNum) || ageNum < 0) {
        await interaction.reply({ 
          content: '❌ Age must be a positive number.', 
          flags: MessageFlags.Ephemeral 
        });
        return;
      }
      value = ageNum.toString();
    } else {
      // Normalize distillery/region names (capitalize first letter of each word)
      value = value.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
    }

    try {
      // Check if alert already exists
      const existingQuery = `
        SELECT id FROM user_alerts 
        WHERE user_id = $1 AND guild_id = $2 AND alert_type = $3 AND alert_value = $4
      `;
      const existing = await this.postgresService.query(existingQuery, [
        interaction.user.id,
        interaction.guildId,
        type,
        value
      ]);

      if (existing.length > 0) {
        await interaction.reply({ 
          content: '⚠️ You already have this alert registered.', 
          flags: MessageFlags.Ephemeral 
        });
        return;
      }

      // Add alert
      const insertQuery = `
        INSERT INTO user_alerts (user_id, guild_id, alert_type, alert_value)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      const result = await this.postgresService.query(insertQuery, [
        interaction.user.id,
        interaction.guildId,
        type,
        value
      ]);

      const alertId = result[0].id;

      let typeLabel = type === 'age' ? `Age over ${value} years` : `${type.charAt(0).toUpperCase() + type.slice(1)}: ${value}`;

      await interaction.reply({ 
        content: `✅ Alert added successfully!\n**Type:** ${typeLabel}\n**ID:** ${alertId}`, 
        flags: MessageFlags.Ephemeral 
      });
    } catch (error) {
      this.logger.error('Error adding alert:', error);
      await interaction.reply({ 
        content: '❌ Failed to add alert. Please try again.', 
        flags: MessageFlags.Ephemeral 
      });
    }
  }

  /**
   * Handle /alert-list command
   */
  private async handleAlertList(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const query = `
        SELECT id, alert_type, alert_value, created_at 
        FROM user_alerts 
        WHERE user_id = $1 AND guild_id = $2
        ORDER BY created_at DESC
      `;
      const alerts = await this.postgresService.query(query, [
        interaction.user.id,
        interaction.guildId
      ]);

      if (alerts.length === 0) {
        await interaction.reply({ 
          content: '📭 You don\'t have any active alerts.', 
          flags: MessageFlags.Ephemeral 
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🔔 Your Active Alerts')
        .setColor(0x5865F2)
        .setDescription(
          alerts.map(alert => {
            let typeLabel = alert.alert_type === 'age' 
              ? `Age over ${alert.alert_value} years`
              : `${alert.alert_type.charAt(0).toUpperCase() + alert.alert_type.slice(1)}: ${alert.alert_value}`;
            return `**ID ${alert.id}:** ${typeLabel}`;
          }).join('\n')
        )
        .setFooter({ text: 'Use /alert-remove [id] to remove an alert' });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error('Error listing alerts:', error);
      await interaction.reply({ 
        content: '❌ Failed to list alerts. Please try again.', 
        flags: MessageFlags.Ephemeral 
      });
    }
  }

  /**
   * Handle /alert-remove command
   */
  private async handleAlertRemove(interaction: ChatInputCommandInteraction): Promise<void> {
    const alertId = interaction.options.getInteger('id', true);

    try {
      const deleteQuery = `
        DELETE FROM user_alerts 
        WHERE id = $1 AND user_id = $2 AND guild_id = $3
        RETURNING id
      `;
      const result = await this.postgresService.query(deleteQuery, [
        alertId,
        interaction.user.id,
        interaction.guildId
      ]);

      if (result.length === 0) {
        await interaction.reply({ 
          content: '❌ Alert not found or you don\'t have permission to remove it.', 
          flags: MessageFlags.Ephemeral 
        });
        return;
      }

      await interaction.reply({ 
        content: `✅ Alert #${alertId} removed successfully!`, 
        flags: MessageFlags.Ephemeral 
      });
    } catch (error) {
      this.logger.error('Error removing alert:', error);
      await interaction.reply({ 
        content: '❌ Failed to remove alert. Please try again.', 
        flags: MessageFlags.Ephemeral 
      });
    }
  }

  /**
   * Send alert notification to user (ephemeral message)
   */
  async sendAlertNotification(
    userId: string, 
    guildId: string, 
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
    matchedAlertValue: string
  ): Promise<void> {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      if (!member) {
        this.logger.warn(`User ${userId} not found in guild ${guildId}`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🎉 Whisky Alert Match!')
        .setColor(0x00FF00)
        .setDescription(`A new whisky matching your alert has been found!`)
        .addFields(
          { name: '🥃 Whisky', value: whiskyData.name, inline: false },
          { name: '🏭 Distillery', value: whiskyData.distillery || 'Unknown', inline: true },
          { name: '🌍 Region', value: whiskyData.region || 'Unknown', inline: true },
          { name: '📅 Age', value: whiskyData.age || 'N/A', inline: true },
          { name: '💰 Price', value: whiskyData.price || 'N/A', inline: true },
          { name: '🔥 ABV', value: whiskyData.abv || 'N/A', inline: true },
          { name: '🔗 Link', value: `[View Product](${whiskyData.url})`, inline: false }
        )
        .setFooter({ text: `Matched your ${matchedAlertType} alert: ${matchedAlertValue}` })
        .setTimestamp();

      // Send DM to user
      await member.send({ embeds: [embed] });
      this.logger.log(`Alert notification sent to user ${userId} for whisky ${whiskyData.name}`);
    } catch (error) {
      this.logger.error(`Failed to send alert notification to user ${userId}:`, error);
    }
  }

  /**
   * Get all alerts from database
   */
  async getAllAlerts(): Promise<UserAlert[]> {
    try {
      const query = `SELECT * FROM user_alerts`;
      const results = await this.postgresService.query(query);
      return results;
    } catch (error) {
      this.logger.error('Error fetching alerts:', error);
      return [];
    }
  }
}