import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAlert } from '../entities/user-alert.entity';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(UserAlert)
    private readonly alertRepo: Repository<UserAlert>,
  ) {}

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

  async findByUser(discordId: string): Promise<UserAlert[]> {
    return this.alertRepo.find({
      where: { userId: discordId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    discordId: string,
    alertType: string,
    alertValue: string,
    guildId?: string,
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
      });
    } catch (error) {
      this.logger.error('Error creating alert:', error);
      throw error;
    }
  }

  async remove(id: number, discordId: string): Promise<void> {
    const result = await this.alertRepo.delete({ id, userId: discordId });
    if (!result.affected) {
      throw new NotFoundException(
        'Alert not found or you do not have permission to remove it.',
      );
    }
  }

  async getAll(): Promise<UserAlert[]> {
    try {
      return await this.alertRepo.find();
    } catch (error) {
      this.logger.error('Error fetching all alerts:', error);
      return [];
    }
  }
}
