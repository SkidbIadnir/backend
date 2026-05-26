import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as admin from 'firebase-admin';
import { User } from '../users/user.entity';
import { SmwsLive } from '../entities/smws-live.entity';
import { AlertsService } from '../alerts/alerts.service';

export type SendPushResult = { success: boolean; error?: string };

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly firebaseEnabled: boolean;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SmwsLive)
    private readonly liveRepo: Repository<SmwsLive>,
    private readonly alertsService: AlertsService,
  ) {
    this.firebaseEnabled = this.initFirebase();
  }

  // ---------------------------------------------------------------------------
  // Firebase initialisation
  // ---------------------------------------------------------------------------

  private initFirebase(): boolean {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase env vars not set — push notifications disabled. ' +
          'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.',
      );
      return false;
    }

    // Guard against double-init (e.g. during hot reload)
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      this.logger.log('Firebase Admin initialised');
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Send a single FCM push
  // ---------------------------------------------------------------------------

  get isEnabled(): boolean {
    return this.firebaseEnabled;
  }

  async sendPush(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.firebaseEnabled) {
      return { success: false, error: 'Firebase not configured' };
    }

    try {
      await admin.messaging().send({
        token,
        notification: { title, body },
        data,
        android: {
          priority: 'high',
          notification: { sound: 'default' },
        },
        // Web push (for browser token testing)
        webpush: {
          notification: { title, body },
        },
      });
      return { success: true };
    } catch (error: any) {
      this.logger.warn(`FCM send failed for token ${token.slice(0, 20)}…: ${error?.message}`);
      return { success: false, error: error?.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers used by the test controller
  // ---------------------------------------------------------------------------

  async getStoredToken(userId: string): Promise<string | null> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { pushToken: true },
    });
    return user?.pushToken ?? null;
  }

  /**
   * Runs the full alert-matching pipeline for a single user against the
   * current live inventory — useful for manual end-to-end testing.
   * Returns the number of whiskies that matched.
   */
  async testMatchForUser(discordId: string): Promise<number> {
    const liveWhiskies = await this.liveRepo.find();
    const alerts = (await this.alertsService.getAllActive()).filter(
      (a) => a.userId === discordId,
    );

    const matched: SmwsLive[] = [];
    for (const whisky of liveWhiskies) {
      for (const alert of alerts) {
        if (
          this.alertsService.matchesAlert(whisky, alert) &&
          !matched.some((w) => w.fullCode === whisky.fullCode)
        ) {
          matched.push(whisky);
        }
      }
    }

    await this.notifyMatchingUsers(matched);
    return matched.length;
  }

  // ---------------------------------------------------------------------------
  // Match new whiskies against active alerts and push to device owners
  // ---------------------------------------------------------------------------

  async notifyMatchingUsers(newWhiskies: SmwsLive[]): Promise<void> {
    if (newWhiskies.length === 0) return;

    const alerts = await this.alertsService.getAllActive();
    if (alerts.length === 0) return;

    // Build a map: discordId → Set of whisky names (to deduplicate per user)
    const matchMap = new Map<string, SmwsLive[]>();

    for (const whisky of newWhiskies) {
      for (const alert of alerts) {
        if (!this.alertsService.matchesAlert(whisky, alert)) continue;

        const existing = matchMap.get(alert.userId) ?? [];
        // Only add this whisky once per user (multiple matching alerts → one notification)
        if (!existing.some((w) => w.fullCode === whisky.fullCode)) {
          existing.push(whisky);
        }
        matchMap.set(alert.userId, existing);
      }
    }

    if (matchMap.size === 0) return;

    // Batch-fetch users that have a push token registered
    const discordIds = [...matchMap.keys()];
    const usersWithTokens = await this.userRepo
      .createQueryBuilder('u')
      .select(['u.discordId', 'u.pushToken'])
      .where('u.discordId IN (:...ids)', { ids: discordIds })
      .andWhere('u.push_token IS NOT NULL')
      .getMany();

    this.logger.log(
      `Sending push notifications to ${usersWithTokens.length} users for ${newWhiskies.length} new whisky/whiskies`,
    );

    for (const user of usersWithTokens) {
      const whiskies = matchMap.get(user.discordId) ?? [];
      if (whiskies.length === 0 || !user.pushToken) continue;

      if (whiskies.length === 1) {
        const w = whiskies[0];
        await this.sendPush(
          user.pushToken,
          'New whisky match 🥃',
          [w.distillery, w.name].filter(Boolean).join(' · '),
          { whiskeyUrl: w.url ?? '', fullCode: w.fullCode },
        );
      } else {
        // Multiple matches → group into one notification
        await this.sendPush(
          user.pushToken,
          `${whiskies.length} new whiskies match your alerts 🥃`,
          whiskies
            .slice(0, 3)
            .map((w) => w.distillery ?? w.name)
            .join(', ') + (whiskies.length > 3 ? '…' : ''),
          { count: String(whiskies.length) },
        );
      }
    }
  }
}
