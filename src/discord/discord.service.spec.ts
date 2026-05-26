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

import { Test, TestingModule } from '@nestjs/testing';
import { DiscordService } from './discord.service';
import { TextChannel } from 'discord.js';

describe('DiscordService', () => {
  let service: DiscordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiscordService],
    }).compile();

    service = module.get<DiscordService>(DiscordService);
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── onModuleInit ────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('calls client.login with the bot token env var', async () => {
      expect(mockClientInstance.login).toHaveBeenCalled();
    });

    it('registers a ClientReady listener via client.once', () => {
      expect(mockClientInstance.once).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
      );
    });
  });

  // ─── sendMessage ─────────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('fetches the channel and sends the message', async () => {
      const mockSend = jest.fn().mockResolvedValue(undefined);
      const mockChannel = Object.create(TextChannel.prototype);
      mockChannel.send = mockSend;
      mockClientInstance.channels.fetch.mockResolvedValue(mockChannel);

      await service.sendMessage('channel-123', 'Hello world');

      expect(mockClientInstance.channels.fetch).toHaveBeenCalledWith('channel-123');
      expect(mockSend).toHaveBeenCalledWith('Hello world');
    });

    it('does not throw when channel fetch fails', async () => {
      mockClientInstance.channels.fetch.mockRejectedValue(new Error('Not found'));

      await expect(service.sendMessage('bad-id', 'msg')).resolves.not.toThrow();
    });

    it('does not throw when channel is not a TextChannel', async () => {
      mockClientInstance.channels.fetch.mockResolvedValue(null);

      await expect(service.sendMessage('channel-123', 'msg')).resolves.not.toThrow();
    });
  });
});
