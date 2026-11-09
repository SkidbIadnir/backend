import { ConflictException } from '@nestjs/common';
import { AdminSmwsService } from './admin-smws.service';

describe('AdminSmwsService.start', () => {
  let sync: { isRunning: jest.Mock; run: jest.Mock };
  let service: AdminSmwsService;

  beforeEach(() => {
    sync = {
      isRunning: jest.fn().mockReturnValue(false),
      run: jest.fn().mockResolvedValue(null),
    };
    service = new AdminSmwsService(null as never, sync as never);
  });

  it('starts an admin run without awaiting it', () => {
    service.start();
    expect(sync.run).toHaveBeenCalledWith('admin');
  });

  it('409s while a run is in progress', () => {
    sync.isRunning.mockReturnValue(true);
    expect(() => service.start()).toThrow(ConflictException);
    expect(sync.run).not.toHaveBeenCalled();
  });
});
