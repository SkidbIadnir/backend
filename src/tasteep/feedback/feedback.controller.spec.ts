import { Test } from '@nestjs/testing';
import type { TasteepAuthRequest } from '../auth/tasteep-jwt-auth.guard';
import { USER_ID } from '../test-utils/fixtures';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

const req = { user: { sub: USER_ID, sid: 'sid' } } as TasteepAuthRequest;

describe('FeedbackController', () => {
  let controller: FeedbackController;
  let service: { create: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'x', created_at: 'y' }),
    };
    const module = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [{ provide: FeedbackService, useValue: service }],
    }).compile();
    controller = module.get(FeedbackController);
  });

  it('creates feedback for the signed-in user', async () => {
    const dto = { type: 'idea' as const, message: 'More charts' };
    await expect(controller.create(req, dto)).resolves.toEqual({
      id: 'x',
      created_at: 'y',
    });
    expect(service.create).toHaveBeenCalledWith(USER_ID, dto);
  });
});
