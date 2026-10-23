import { ConflictException } from '@nestjs/common';
import { AdminSmwsService } from './admin-smws.service';

const idle = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
};

describe('AdminSmwsService.start', () => {
  let scraper: {
    getRunState: jest.Mock;
    runScraper: jest.Mock;
    runArchiveScraper: jest.Mock;
  };
  let service: AdminSmwsService;

  beforeEach(() => {
    scraper = {
      getRunState: jest.fn().mockReturnValue({ live: idle, archive: idle }),
      runScraper: jest.fn().mockResolvedValue(undefined),
      runArchiveScraper: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminSmwsService(
      null as never,
      null as never,
      null as never,
      null as never,
      scraper as never,
    );
  });

  it('starts the live run without awaiting it', () => {
    service.start('live');
    expect(scraper.runScraper).toHaveBeenCalledTimes(1);
    expect(scraper.runArchiveScraper).not.toHaveBeenCalled();
  });

  it('starts the archive run', () => {
    service.start('archive');
    expect(scraper.runArchiveScraper).toHaveBeenCalledTimes(1);
  });

  it('409s when that scraper is already running', () => {
    scraper.getRunState.mockReturnValue({
      live: { ...idle, running: true },
      archive: idle,
    });
    expect(() => service.start('live')).toThrow(ConflictException);
    expect(scraper.runScraper).not.toHaveBeenCalled();
  });

  it('does not let a rejected run become an unhandled rejection', async () => {
    scraper.runScraper.mockRejectedValue(new Error('boom'));
    expect(() => service.start('live')).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
