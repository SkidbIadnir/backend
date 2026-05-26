import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAlert } from '../entities/user-alert.entity';
import { SmwsLive } from '../entities/smws-live.entity';
import { UpdateAlertDto } from './dto/update-alert.dto';

export type AlertWithCount = UserAlert & { matchCount: number };

type AlertWhiskyFields = Pick<
  SmwsLive,
  'distillery' | 'distilleryCode' | 'region' | 'age'
>;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(UserAlert)
    private readonly alertRepo: Repository<UserAlert>,
    @InjectRepository(SmwsLive)
    private readonly liveRepo: Repository<SmwsLive>,
  ) {}

  // ---------------------------------------------------------------------------
  // Matching logic (extracted from scraper so it can be reused here)
  // ---------------------------------------------------------------------------

  matchesAlert(whisky: AlertWhiskyFields, alert: UserAlert): boolean {
    switch (alert.alertType) {
      case 'distillery': {
        const nameMatch =
          whisky.distillery?.toLowerCase() === alert.alertValue.toLowerCase();
        const codeMatch =
          whisky.distilleryCode?.toLowerCase() ===
          alert.alertValue.toLowerCase();
        return nameMatch || codeMatch;
      }
      case 'region':
        return (
          whisky.region?.toLowerCase() === alert.alertValue.toLowerCase()
        );
      case 'age': {
        const minAge = parseInt(alert.alertValue);
        const whiskyAge = parseInt(whisky.age || '');
        return !isNaN(minAge) && !isNaN(whiskyAge) && whiskyAge >= minAge;
      }
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Value normalisation
  // ---------------------------------------------------------------------------

  normalizeValue(alertType: string, rawValue: string): string {
    if (alertType === 'age') {
      const ageNum = parseInt(rawValue);
      if (isNaN(ageNum) || ageNum < 0) {
        throw new Error('Age must be a positive number.');
      }
      return ageNum.toString();
    }
    return rawValue.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async findByUser(discordId: string): Promise<AlertWithCount[]> {
    const [alerts, liveWhiskies] = await Promise.all([
      this.alertRepo.find({ where: { userId: discordId } }),
      this.liveRepo.find(),
    ]);

    const enriched: AlertWithCount[] = alerts.map((alert) => {
      const matchCount = liveWhiskies.filter((w) =>
        this.matchesAlert(w, alert),
      ).length;
      return Object.assign(Object.create(Object.getPrototypeOf(alert)), alert, {
        matchCount,
      });
    });

    // Active alerts first, then inactive; within each group keep DB order
    enriched.sort((a, b) => {
      if (a.isActive === b.isActive) return 0;
      return a.isActive ? -1 : 1;
    });

    return enriched;
  }

  async create(
    discordId: string,
    alertType: string,
    alertValue: string,
    guildId?: string,
    name?: string,
  ): Promise<UserAlert> {
    const normalizedValue = this.normalizeValue(alertType, alertValue);

    const existing = await this.alertRepo.findOne({
      where: { userId: discordId, alertType, alertValue: normalizedValue },
    });

    if (existing) {
      throw new ConflictException('You already have this alert registered.');
    }

    try {
      return await this.alertRepo.save({
        userId: discordId,
        guildId: guildId ?? null,
        alertType,
        alertValue: normalizedValue,
        name: name ?? null,
        isActive: true,
      });
    } catch (error) {
      this.logger.error('Error creating alert:', error);
      throw error;
    }
  }

  async update(
    id: number,
    discordId: string,
    dto: UpdateAlertDto,
  ): Promise<UserAlert> {
    const alert = await this.alertRepo.findOne({
      where: { id, userId: discordId },
    });

    if (!alert) {
      throw new NotFoundException(
        'Alert not found or you do not have permission to update it.',
      );
    }

    if (dto.name !== undefined) alert.name = dto.name;
    if (dto.isActive !== undefined) alert.isActive = dto.isActive;

    if (dto.alertType !== undefined || dto.alertValue !== undefined) {
      const newType = dto.alertType ?? alert.alertType;
      const newValue = dto.alertValue ?? alert.alertValue;
      alert.alertType = newType;
      alert.alertValue = this.normalizeValue(newType, newValue);
    }

    return this.alertRepo.save(alert);
  }

  async remove(id: number, discordId: string): Promise<void> {
    const result = await this.alertRepo.delete({ id, userId: discordId });
    if (!result.affected) {
      throw new NotFoundException(
        'Alert not found or you do not have permission to remove it.',
      );
    }
  }

  async getMatches(id: number, discordId: string): Promise<SmwsLive[]> {
    const alert = await this.alertRepo.findOne({
      where: { id, userId: discordId },
    });

    if (!alert) {
      throw new NotFoundException(
        'Alert not found or you do not have permission to view it.',
      );
    }

    const liveWhiskies = await this.liveRepo.find();
    return liveWhiskies.filter((w) => this.matchesAlert(w, alert));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async getAll(): Promise<UserAlert[]> {
    try {
      return await this.alertRepo.find();
    } catch (error) {
      this.logger.error('Error fetching all alerts:', error);
      return [];
    }
  }

  async getAllActive(): Promise<UserAlert[]> {
    try {
      return await this.alertRepo.find({ where: { isActive: true } });
    } catch (error) {
      this.logger.error('Error fetching active alerts:', error);
      return [];
    }
  }
}
