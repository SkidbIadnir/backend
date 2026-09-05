import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { tasteepConfig } from '../tasteep-config';

/**
 * Sends transactional email over SMTP. When `TASTEEP_SMTP_HOST` is not set the
 * service runs in dev mode: nothing is sent and the OTP is written to the log.
 */
@Injectable()
export class TasteepMailService {
  private readonly logger = new Logger(TasteepMailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor() {
    const smtp = tasteepConfig.smtp;
    if (!smtp) {
      this.logger.warn(
        'TASTEEP_SMTP_HOST not set — OTP codes will be logged instead of emailed (dev mode).',
      );
      this.transporter = null;
      this.from = '';
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    this.from = smtp.from;
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendOtp(
    email: string,
    code: string,
    ttlMinutes: number,
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[dev] OTP for ${email}: ${code} (valid ${ttlMinutes} min)`,
      );
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: `${code} is your Tasteep sign-in code`,
      text:
        `Your Tasteep sign-in code is ${code}.\n\n` +
        `It expires in ${ttlMinutes} minutes. If you did not request it, ignore this email.`,
      html:
        `<p>Your Tasteep sign-in code is</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>` +
        `<p>It expires in ${ttlMinutes} minutes. If you did not request it, ignore this email.</p>`,
    });
  }
}
