import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TasteepFeedback } from '../entities/tasteep-feedback.entity';
import {
  createMockRepository,
  MockRepository,
} from '../../test-utils/mock-repository.factory';
import { USER_ID } from '../test-utils/fixtures';
import { FeedbackService } from './feedback.service';

const FEEDBACK_ID = '77777777-7777-4777-8777-777777777777';
const CREATED_AT = new Date('2026-11-17T10:00:00.000Z');

describe('FeedbackService', () => {
  let service: FeedbackService;
  let repo: MockRepository<TasteepFeedback>;
  const env = process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR;

  beforeEach(async () => {
    delete process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR;
    repo = createMockRepository<TasteepFeedback>();
    repo.count!.mockResolvedValue(0);
    repo.save!.mockImplementation((row: Partial<TasteepFeedback>) =>
      Promise.resolve({ ...row, id: FEEDBACK_ID, createdAt: CREATED_AT }),
    );
    const module = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: getRepositoryToken(TasteepFeedback), useValue: repo },
      ],
    }).compile();
    service = module.get(FeedbackService);
  });

  afterAll(() => {
    if (env === undefined) delete process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR;
    else process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR = env;
  });

  it('saves the trimmed message for the user and returns id + created_at', async () => {
    const res = await service.create(USER_ID, {
      type: 'bug',
      message: '  The map crashes  ',
      app_version: ' 1.4.0+42 ',
      platform: 'ios',
    });

    expect(repo.save).toHaveBeenCalledWith({
      userId: USER_ID,
      type: 'bug',
      message: 'The map crashes',
      appVersion: '1.4.0+42',
      platform: 'ios',
    });
    expect(res).toEqual({
      id: FEEDBACK_ID,
      created_at: CREATED_AT.toISOString(),
    });
  });

  it('stores missing or blank app_version / platform as null', async () => {
    await service.create(USER_ID, {
      type: 'idea',
      message: 'Dark mode',
      platform: '  ',
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ appVersion: null, platform: null }),
    );
  });

  it('rejects a whitespace-only message', async () => {
    await expect(
      service.create(USER_ID, { type: 'other', message: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('counts only this user’s feedback from the last hour', async () => {
    await service.create(USER_ID, { type: 'other', message: 'hi' });
    const [opts] = repo.count!.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(opts.where.userId).toBe(USER_ID);
    expect(opts.where.createdAt).toBeDefined();
  });

  it('returns 429 once the hourly limit is reached', async () => {
    process.env.TASTEEP_FEEDBACK_MAX_PER_HOUR = '3';
    repo.count!.mockResolvedValue(3);

    const err = await service
      .create(USER_ID, { type: 'bug', message: 'again' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});
