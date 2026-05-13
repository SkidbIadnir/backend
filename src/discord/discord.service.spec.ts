let mockClientInstance: {
  login: jest.Mock;
  once: jest.Mock;
  on: jest.Mock;
  user: { id: string; tag: string; setActivity: jest.Mock };
  guilds: { fetch: jest.Mock };
  channels: { fetch: jest.Mock };
};

jest.mock('discord.js', () => {
  mockClientInstance = {
    login: jest.fn().mockResolvedValue('token'),
    once: jest.fn(),
    on: jest.fn(),
    user: { id: 'bot-id', tag: 'Bot#0000', setActivity: jest.fn() },
    guilds: { fetch: jest.fn() },
    channels: { fetch: jest.fn() },
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

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiscordService } from './discord.service';
import { UserAlert } from '../entities/user-alert.entity';
import { createMockRepository, MockRepository } from '../test-utils/mock-repository.factory';
import { makeUserAlert } from '../test-utils/fixtures';
import { makeMockInteraction } from '../test-utils/mock-interaction.factory';

describe('DiscordService', () => {
  let service: DiscordService;
  let alertRepo: MockRepository<UserAlert>;

  beforeEach(async () => {
    alertRepo = createMockRepository<UserAlert>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordService,
        { provide: getRepositoryToken(UserAlert), useValue: alertRepo },
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
    it('saves a valid age alert and replies with success', async () => {
      const interaction = makeMockInteraction({
        commandName: 'alert-add',
        stringOptions: { type: 'age', value: '15' },
      });
      alertRepo.findOne!.mockResolvedValue(null);
      alertRepo.save!.mockResolvedValue(makeUserAlert({ id: 42, alertType: 'age', alertValue: '15' }));

      await (service as any).handleAlertAdd(interaction);

      expect(alertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertType: 'age', alertValue: '15' }),
      );
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('42') }),
      );
    });

    it('replies with error and does not save for negative age', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'age', value: '-1' },
      });

      await (service as any).handleAlertAdd(interaction);

      expect(alertRepo.save).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('positive') }),
      );
    });

    it('replies with error and does not save for non-numeric age', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'age', value: 'fifteen' },
      });

      await (service as any).handleAlertAdd(interaction);

      expect(alertRepo.save).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('positive') }),
      );
    });

    it('title-cases non-age alert value before saving', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'region', value: 'speyside' },
      });
      alertRepo.findOne!.mockResolvedValue(null);
      alertRepo.save!.mockResolvedValue(makeUserAlert({ alertType: 'region', alertValue: 'Speyside' }));

      await (service as any).handleAlertAdd(interaction);

      expect(alertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertValue: 'Speyside' }),
      );
    });

    it('replies with duplicate message and does not save when alert exists', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'distillery', value: 'Glenfarclas' },
      });
      alertRepo.findOne!.mockResolvedValue(makeUserAlert());

      await (service as any).handleAlertAdd(interaction);

      expect(alertRepo.save).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already') }),
      );
    });

    it('replies with failure message when save throws', async () => {
      const interaction = makeMockInteraction({
        stringOptions: { type: 'distillery', value: 'Glenfarclas' },
      });
      alertRepo.findOne!.mockResolvedValue(null);
      alertRepo.save!.mockRejectedValue(new Error('DB error'));

      await (service as any).handleAlertAdd(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') }),
      );
    });
  });

  // ─── handleAlertList ─────────────────────────────────────────────────────────

  describe('handleAlertList', () => {
    it('replies with no-alerts message when list is empty', async () => {
      alertRepo.find!.mockResolvedValue([]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('active alerts') }),
      );
    });

    it('replies with an embed when alerts exist', async () => {
      alertRepo.find!.mockResolvedValue([makeUserAlert({ id: 7 })]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      const call = (interaction.reply as jest.Mock).mock.calls[0][0];
      expect(call.embeds).toBeDefined();
      expect(call.embeds).toHaveLength(1);
    });

    it('formats age alert label as "Age over X years"', async () => {
      alertRepo.find!.mockResolvedValue([makeUserAlert({ alertType: 'age', alertValue: '12' })]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      const embed = (interaction.reply as jest.Mock).mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('Age over 12 years');
    });

    it('formats non-age alert label with capitalised type', async () => {
      alertRepo.find!.mockResolvedValue([makeUserAlert({ alertType: 'region', alertValue: 'Speyside' })]);
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      const embed = (interaction.reply as jest.Mock).mock.calls[0][0].embeds[0];
      expect(embed.data.description).toContain('Region: Speyside');
    });

    it('replies with failure message when find throws', async () => {
      alertRepo.find!.mockRejectedValue(new Error('DB error'));
      const interaction = makeMockInteraction({ commandName: 'alert-list' });

      await (service as any).handleAlertList(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') }),
      );
    });
  });

  // ─── handleAlertRemove ────────────────────────────────────────────────────────

  describe('handleAlertRemove', () => {
    it('calls delete with correct params and replies with success on affected=1', async () => {
      alertRepo.delete!.mockResolvedValue({ affected: 1, raw: [] });
      const interaction = makeMockInteraction({
        commandName: 'alert-remove',
        integerOptions: { id: 7 },
      });

      await (service as any).handleAlertRemove(interaction);

      expect(alertRepo.delete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, userId: 'user-123', guildId: 'guild-456' }),
      );
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('7') }),
      );
    });

    it('replies with not-found message when affected=0', async () => {
      alertRepo.delete!.mockResolvedValue({ affected: 0, raw: [] });
      const interaction = makeMockInteraction({ integerOptions: { id: 99 } });

      await (service as any).handleAlertRemove(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not found') }),
      );
    });

    it('replies with failure message when delete throws', async () => {
      alertRepo.delete!.mockRejectedValue(new Error('DB error'));
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

    it('sends a DM embed to the matched guild member', async () => {
      const mockSend = jest.fn().mockResolvedValue(undefined);
      const mockMember = { send: mockSend };
      const mockGuild = { members: { fetch: jest.fn().mockResolvedValue(mockMember) } };
      mockClientInstance.guilds.fetch.mockResolvedValue(mockGuild);

      await service.sendAlertNotification('user-123', 'guild-456', whiskyData, 'distillery', 'Glenfarclas');

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
      const embed = mockSend.mock.calls[0][0].embeds[0];
      expect(embed.data.fields?.some((f: any) => f.value === 'The Dram')).toBe(true);
    });

    it('does not throw when guild.members.fetch throws', async () => {
      const mockGuild = { members: { fetch: jest.fn().mockRejectedValue(new Error('User not in guild')) } };
      mockClientInstance.guilds.fetch.mockResolvedValue(mockGuild);

      await expect(
        service.sendAlertNotification('user-123', 'guild-456', whiskyData, 'distillery', 'Glenfarclas'),
      ).resolves.not.toThrow();
    });

    it('does not call member.send when guild fetch returns falsy', async () => {
      mockClientInstance.guilds.fetch.mockResolvedValue(null);

      await expect(
        service.sendAlertNotification('user-123', 'guild-456', whiskyData, 'distillery', 'Glenfarclas'),
      ).resolves.not.toThrow();
    });
  });

  // ─── getAllAlerts ─────────────────────────────────────────────────────────────

  describe('getAllAlerts', () => {
    it('returns result of alertRepo.find', async () => {
      const alerts = [makeUserAlert()];
      alertRepo.find!.mockResolvedValue(alerts);
      const result = await service.getAllAlerts();
      expect(result).toEqual(alerts);
    });

    it('returns empty array when alertRepo.find throws', async () => {
      alertRepo.find!.mockRejectedValue(new Error('DB error'));
      const result = await service.getAllAlerts();
      expect(result).toEqual([]);
    });
  });
});
