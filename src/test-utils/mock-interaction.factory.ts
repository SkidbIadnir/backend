export interface MockInteractionOptions {
  commandName?: string;
  userId?: string;
  guildId?: string;
  stringOptions?: Record<string, string | null>;
  integerOptions?: Record<string, number | null>;
}

export const makeMockInteraction = (overrides: MockInteractionOptions = {}) => ({
  commandName: overrides.commandName ?? 'alert-add',
  user: { id: overrides.userId ?? 'user-123' },
  guildId: overrides.guildId ?? 'guild-456',
  replied: false,
  reply: jest.fn().mockResolvedValue(undefined),
  isChatInputCommand: jest.fn().mockReturnValue(true),
  options: {
    getString: jest.fn((name: string, _required?: boolean) =>
      overrides.stringOptions?.[name] ?? null,
    ),
    getInteger: jest.fn((name: string, _required?: boolean) =>
      overrides.integerOptions?.[name] ?? null,
    ),
  },
});
