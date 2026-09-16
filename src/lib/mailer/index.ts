import tls from 'node:tls';
import { getConfig } from '@/lib/config';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/models';

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class LogMailer implements Mailer {
  async send({ to, subject, body }: MailMessage): Promise<void> {
    console.log(`[mailer:log] to=${to} subject="${subject}"\n${body}`);
  }
}

export class SmtpMailer implements Mailer {
  private username: string;
  private password: string;
  private host: string;
  private port: number;

  constructor({
    username,
    password,
    host = 'smtp.gmail.com',
    port = 465,
  }: {
    username: string;
    password: string;
    host?: string;
    port?: number;
  }) {
    this.username = username;
    this.password = password;
    this.host = host;
    this.port = port;
  }

  async send({ to, subject, body }: MailMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: this.host,
          port: this.port,
          rejectUnauthorized: true,
        },
        () => {
          let buffer = '';

          const sendCommand = (cmd: string) => {
            socket.write(`${cmd}\r\n`);
          };

          const handleStep = (data: Buffer) => {
            buffer += data.toString('utf-8');
            const lines = buffer.split('\r\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const code = parseInt(line.substring(0, 3), 10);
              if (isNaN(code) || line.charAt(3) === '-') continue; // Multi-line response continuation

              if (code === 220) {
                // Greeting -> EHLO
                sendCommand(`EHLO ${this.host}`);
              } else if (code === 250 && !stepAuthStarted) {
                // After EHLO -> AUTH PLAIN
                stepAuthStarted = true;
                const authString = Buffer.from(
                  `\0${this.username}\0${this.password}`
                ).toString('base64');
                sendCommand(`AUTH PLAIN ${authString}`);
              } else if (code === 235) {
                // Auth success -> MAIL FROM
                sendCommand(`MAIL FROM:<${this.username}>`);
              } else if (code === 250 && stepAuthStarted && !stepMailFromDone) {
                stepMailFromDone = true;
                sendCommand(`RCPT TO:<${to}>`);
              } else if (code === 250 && stepMailFromDone && !stepRcptDone) {
                stepRcptDone = true;
                sendCommand('DATA');
              } else if (code === 354) {
                // Ready for body
                const emailData = [
                  `From: ${this.username}`,
                  `To: ${to}`,
                  `Subject: ${subject}`,
                  'MIME-Version: 1.0',
                  'Content-Type: text/plain; charset=utf-8',
                  '',
                  body,
                  '.',
                ].join('\r\n');
                sendCommand(emailData);
              } else if (code === 250 && stepRcptDone) {
                // Message sent
                sendCommand('QUIT');
                socket.end();
                resolve();
              } else if (code >= 400) {
                socket.end();
                reject(new Error(`SMTP error (${code}): ${line}`));
              }
            }
          };

          let stepAuthStarted = false;
          let stepMailFromDone = false;
          let stepRcptDone = false;

          socket.on('data', handleStep);
          socket.on('error', (err) => reject(err));
        }
      );

      if (typeof socket.setTimeout === 'function') {
        socket.setTimeout(10000);
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('SMTP connection timed out'));
        });
      }

      socket.on('error', (err) => reject(err));
    });
  }
}

let activeMailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (activeMailer) return activeMailer;

  try {
    const config = getConfig();
    if (config.gmailSmtpUser && config.gmailSmtpAppPassword) {
      activeMailer = new SmtpMailer({
        username: config.gmailSmtpUser,
        password: config.gmailSmtpAppPassword,
      });
      return activeMailer;
    }
  } catch {
    // Fallback to LogMailer
  }

  activeMailer = new LogMailer();
  return activeMailer;
}

export function setMailer(mailer: Mailer | null): void {
  activeMailer = mailer;
}

export async function sendQuietly(mailer: Mailer, message: MailMessage): Promise<void> {
  try {
    await mailer.send(message);
  } catch (err) {
    console.error('mailer send failed:', err);
  }
}

export async function notifySubQuietly({
  sub,
  subject,
  body,
  mailer,
}: {
  sub: string;
  subject: string;
  body: string;
  mailer?: Mailer;
}): Promise<void> {
  try {
    await connectToDatabase();
    const user = await User.findOne({ sub });
    if (!user || !user.email) return;

    const m = mailer || getMailer();
    await sendQuietly(m, { to: user.email, subject, body });
  } catch (err) {
    console.error(`mailer notify failed for sub=${sub}:`, err);
  }
}
