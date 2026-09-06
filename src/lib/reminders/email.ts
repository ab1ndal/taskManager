import 'server-only';
import nodemailer from 'nodemailer';

export function emailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD && process.env.REMINDER_APP_URL);
}
export type EmailPayload = { from: string; to: string[]; subject: string; text: string; html: string };
export async function sendEmail(payload: EmailPayload, messageId: string) {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
  });
  try { await transport.sendMail({ ...payload, messageId }); }
  finally { transport.close(); }
}
