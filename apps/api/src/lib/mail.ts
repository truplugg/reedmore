import nodemailer from 'nodemailer';
import { env } from './env.js';

/**
 * Password reset has to work on a fresh clone with no SMTP account (§15), so
 * the default driver prints the message. Switching to real mail is one env
 * var and no code change.
 */
const transport = env.MAIL_DRIVER === 'smtp'
  ? nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    })
  : nodemailer.createTransport({ jsonTransport: true });

export interface Mail { to: string; subject: string; text: string; html?: string }

export async function sendMail(mail: Mail): Promise<void> {
  const info = await transport.sendMail({ from: env.MAIL_FROM, ...mail });
  if (env.MAIL_DRIVER === 'console') {
    console.log('\n──── mail ────────────────────────────────');
    console.log(`to:      ${mail.to}`);
    console.log(`subject: ${mail.subject}`);
    console.log(mail.text);
    console.log('──────────────────────────────────────────\n');
  }
  void info;
}
