let mockClientInstance: {
  login: jest.Mock;
  once: jest.Mock;
  on: jest.Mock;
  user: { id: string; tag: string; setActivity: jest.Mock };
  guilds: { fetch: jest.Mock };
  channels: { fetch: jest.Mock };
  users: { fetch: jest.Mock };
};

jest.mock('discord.js', () => {
  mockClientInstance = {
    login: jest.fn().mockResolvedValue('token'),
    once: jest.fn(),
    on: jest.fn(),
    user: { id: 'bot-id', tag: 'Bot#0000', setActivity: jest.fn() },
    guilds: { fetch: jest.fn() },
    channels: { fetch: jest.fn() },
    users: { fetch: jest.fn() },
  };

  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    Client: jest.fn(() => mockClientInstance),
    REST: jest.fn(() => ({
      setToken: jest.fn().mockReturnThis(),
      put: jest.fn().mockResolvedValue([]),
    })),
    Routes: { applicationCommands: jest.fn().mockReturnValue('/commands') },
  };
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordService } from './discord.service';
import { AlertsService } from '../alerts/alerts.service';
import { makeUserAlert } from '../test-utils/fixtures';
import { makeMockInteraction } from '../test-utils/mock-interaction.factory';

type MockAlertsService = {
  normalizeValue: jest.Mock;
  findByUser: jest.Mock;
  create: jest.Mock;
  remove: jest.Mock;
  getAll: jest.Mock;
};

function createMockAlertsService(): MockAlertsService {
  return {
    normalizeValue: jest.fn((type: string, val: string) => {
      if (type === 'age') {
        const n = parseInt(val);
        if (isNaN(n) || n < 0) throw new Error('Age must be a positive number.');
        return n.toString();
      }
      return val.toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase());
    }),
    findByUser: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
    getAll: jest.fn(),
  };
}

describe('DiscordService', () => {
  let service: DiscordService;
  let alertsService: MockAlertsService;

  beforeEach(async () => {
    alertsService = createMockAlertsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordService,
        { provide: AlertsService, useValue: alertsService },
      ],
    }).compile();

    service = module.get<DiscordService>(DiscordService);
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── handleAlertAdd ──────────────────────────────────────────────────────────

  describe('handleAlertAdd', () => {
    it('creates a valid age alert and replies with success', async () => {
      const interaction = makeMockInteraction({
        commandName: 'alert-add',
        stringOptions: { type: 'age', value: '15' },
      });
      alertsService.create.mockResolvedValue(makeUserAlert({ id: 42, alertType: 'age', alertValue: '15' }));

      await (service as any).handleAlertAdd(interaction);

      expect(alertsService.create).toHaveBeenCalledWith(
        'user-123', 'age', '15', 'guild-456',
      );
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('42') }),
      );
    });

    it('replies with error and does not create for negative age', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'age', value: '-1' },
      });

      await (service as any).handleAlertAdd(interaction);

      expect(alertsService.create).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('positive') }),
      );
    });

    it('replies with error and does not create for non-numeric age', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'age', value: 'fifteen' },
      });

      await (service as any).handleAlertAdd(interaction);

      expect(alertsService.create).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('positive') }),
      );
    });

    it('reply label uses title-cased value for non-age alert', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'region', value: 'speyside' },
      });
      alertsService.create.mockResolvedValue(makeUserAlert({ alertType: 'region', alertValue: 'Speyside' }));

      await (service as any).handleAlertAdd(interaction);

      expect(alertsService.create).toHaveBeenCalledWith(
        'user-123', 'region', 'speyside', 'guild-456',
      );
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Speyside') }),
      );
    });

    it('replies with duplicate message when create throws ConflictException', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'distillery', value: 'Glenfarclas' },
      });
      alertsService.create.mockRejectedValue(new ConflictException('already have'));

      await (service as any).handleAlertAdd(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already') }),
      );
    });

    it('replies with failure message when create throws a generic error', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'distillery', value: 'Glenfarclas' },
      });
      alertsService.create.mockRejectedValue(new Error('DB error'));

      await (service as any).handleAlertAdd(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') }),
      );
    });
  });

  // ─── handleAlertList ─────────────────────────────────────────────────────────

  describe('handleAlertList', () => {
    it('replies with no-alerts message when list is empty', async () => {
      alertsService.findByUser.mockResolvedValue([]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('active alerts') }),
      );
    });

    it('replies with an embed when alerts exist', async () => {
      alertsService.findByUser.mockResolvedValue([makeUserAlert({ id: 7 })]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      const call = (interaction.reply as jest.Mock).mock.calls[0][0];
      expect(call.embeds).toBeDefined();
      expect(call.embeds).toHaveLength(1);
    });

    it('formats age alert label as "Age over X years"', async () => {
      alertsService.findByUser.mockResolvedValue([makeUserAlert({ alertType: 'age', alertValue: '12' })]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      const embed = (interaction.reply as jest.Mock).mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('Age over 12 years');
    });

    it('formats non-age alert label with capitalised type', async () => {
      alertsService.findByUser.mockResolvedValue([makeUserAlert({ alertType: 'region', alertValue: 'Speyside' })]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      const embed = (interaction.reply as jest.Mock).mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('Region: Speyside');
    });

    it('replies with failure message when findByUser throws', async () => {
      alertsService.findByUser.mockRejectedValue(new Error('DB error'));
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') }),
      );
    });
  });

  // ─── handleAlertRemove ────────────────────────────────────────────────────────

  describe('handleAlertRemove', () => {
    it('calls remove with correct params and replies with success', async () => {
      alertsService.remove.mockResolvedValue(undefined);
      const interaction = makeMockInteraction({
        commandName: 'alert-remove',
        integerOptions: { id: 7 },
      });

      await (service as any).handleAlertRemove(interaction);

      expect(alertsService.remove).toHaveBeenCalledWith(7, 'user-123');
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('7') }),
      );
    });

    it('replies with not-found message when remove throws NotFoundException', async () => {
      alertsService.remove.mockRejectedValue(new NotFoundException('not found'));
      const interaction = makeMockInteraction({ integerOptions: { id: 99 } });

      await (service as any).handleAlertRemove(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not found') }),
      );
    });

    it('replies with failure message when remove throws a generic error', async () => {
      alertsService.remove.mockRejectedValue(new Error('DB error'));
      const interaction = makeMockInteraction({ integerOptions: { id: 1 } });

      await (service as any).handleAlertRemove(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') }),
      );
    });
  });

  // ─── sendAlertNotification ───────────────────────────────────────────────────

  describe('sendAlertNotification', () => {
    const whiskyData = {
      name: 'The Dram',
      distillery: 'Glenfarclas',
      region: 'Speyside',
      age: '12 years',
      price: '£85.00',
      abv: '58.2%',
      url: 'https://smws.eu/product/1.100',
    };

    it('sends a DM embed via guild member when guildId is provided', async () => {
      const mockSend = jest.fn().mockResolvedValue(undefined);
      const mockMember = { send: mockSend };
      const mockGuild = { members: { fetch: jest.fn().mockResolvedValue(mockMember) } };
      mockClientInstance.guilds.fetch.mockResolvedValue(mockGuild);

      await service.sendAlertNotification('user-123', 'guild-456', whiskyData, 'distillery', 'Glenfarclas');

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
      const embed = mockSend.mock.calls[0][0].embeds[0];
      expect(embed.data.fields?.some((f: any) => f.value === 'The Dram')).toBe(true);
    });

    it('sends a DM directly via users.fetch when guildId is null', async () => {
      const mockSend = jest.fn().mockResolvedValue(undefined);
      mockClientInstance.users.fetch.mockResolvedValue({ send: mockSend });

      await service.sendAlertNotification('user-123', null, whiskyData, 'distillery', 'Glenfarclas');

      expect(mockClientInstance.guilds.fetch).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });

    it('does not throw when guild.members.fetch throws', async () => {
      const mockGuild = { members: { fetch: jest.fn().mockRejectedValue(new Error('User not in guild')) } };
      mockClientInstance.guilds.fetch.mockResolvedValue(mockGuild);

      await expect(
        service.sendAlertNotification('user-123', 'guild-456', whiskyData, 'distillery', 'Glenfarclas'),
      ).resolves.not.toThrow();
    });

    it('does not throw when guild fetch returns null', async () => {
      mockClientInstance.guilds.fetch.mockResolvedValue(null);

      await expect(
        service.sendAlertNotification('user-123', 'guild-456', whiskyData, 'distillery', 'Glenfarclas'),
      ).resolves.not.toThrow();
    });
  });

  // ─── getAllAlerts ─────────────────────────────────────────────────────────────

  describe('getAllAlerts', () => {
    it('returns result of alertsService.getAll', async () => {
      const alerts = [makeUserAlert()];
      alertsService.getAll.mockResolvedValue(alerts);
      const result = await service.getAllAlerts();
      expect(result).toEqual(alerts);
    });

    it('returns empty array when alertsService.getAll returns empty', async () => {
      alertsService.getAll.mockResolvedValue([]);
      const result = await service.getAllAlerts();
      expect(result).toEqual([]);
    });
  });
});
