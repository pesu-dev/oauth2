import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogMailer, SmtpMailer, getMailer, setMailer, sendQuietly, notifySubQuietly } from '@/lib/mailer';
import { User } from '@/lib/db/models';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    gmailSmtpUser: 'test@pesu.edu',
    gmailSmtpAppPassword: 'test-app-password',
  })),
}));

describe('Transactional Mailer Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMailer(null);
  });

  describe('LogMailer', () => {
    it('executes send without throwing', async () => {
      const mailer = new LogMailer();
      await expect(
        mailer.send({
          to: 'student@pesu.edu',
          subject: 'Test Subject',
          body: 'Test Body',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('sendQuietly & notifySubQuietly', () => {
    it('sendQuietly catches and swallows errors', async () => {
      const failingMailer = {
        send: vi.fn().mockRejectedValue(new Error('SMTP connection timed out')),
      };
      await expect(
        sendQuietly(failingMailer, {
          to: 'student@pesu.edu',
          subject: 'Test',
          body: 'Test',
        })
      ).resolves.toBeUndefined();
    });

    it('notifySubQuietly handles non-existent user safely', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
      await expect(
        notifySubQuietly({
          sub: 'usr_ghost',
          subject: 'Notification',
          body: 'Message',
        })
      ).resolves.toBeUndefined();
    });

    it('notifySubQuietly delivers email when user has email address', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_real',
        email: 'real@pesu.edu',
      } as never);

      const mockMailer = { send: vi.fn().mockResolvedValue(undefined) };
      await notifySubQuietly({
        sub: 'usr_real',
        subject: 'Notification',
        body: 'Message',
        mailer: mockMailer,
      });

      expect(mockMailer.send).toHaveBeenCalledWith({
        to: 'real@pesu.edu',
        subject: 'Notification',
        body: 'Message',
      });
    });
  });

  describe('getMailer & setMailer', () => {
    it('getMailer returns SmtpMailer when config is present', () => {
      const mailer = getMailer();
      expect(mailer).toBeInstanceOf(SmtpMailer);
    });

    it('setMailer allows custom mailer injection', () => {
      const custom = new LogMailer();
      setMailer(custom);
      expect(getMailer()).toBe(custom);
    });
  });

  describe('SmtpMailer Protocol Simulation', () => {
    it('completes SMTP handshake and message transmission', async () => {
      const mockSocket = new EventEmitter() as unknown as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockSocket.write = vi.fn();
      mockSocket.end = vi.fn();
      vi.spyOn(tls, 'connect').mockImplementation((...args: unknown[]) => {
        const connectListener = typeof args[1] === 'function' ? (args[1] as () => void) : typeof args[0] === 'function' ? (args[0] as () => void) : null;
        if (connectListener) {
          setTimeout(() => {
            connectListener();
            // 1. Send greeting 220
            mockSocket.emit('data', Buffer.from('220 smtp.gmail.com Ready\r\n'));
            // 2. Send EHLO response 250
            mockSocket.emit('data', Buffer.from('250-smtp.gmail.com at your service\r\n250 AUTH PLAIN\r\n'));
            // 3. Send AUTH PLAIN success 235
            mockSocket.emit('data', Buffer.from('235 2.7.0 Accepted\r\n'));
            // 4. Send MAIL FROM success 250
            mockSocket.emit('data', Buffer.from('250 2.1.0 OK\r\n'));
            // 5. Send RCPT TO success 250
            mockSocket.emit('data', Buffer.from('250 2.1.5 OK\r\n'));
            // 6. Send DATA prompt 354
            mockSocket.emit('data', Buffer.from('354 Go ahead\r\n'));
            // 7. Send message accepted 250
            mockSocket.emit('data', Buffer.from('250 2.0.0 OK message queued\r\n'));
          }, 5);
        }
        return mockSocket as never;
      });

      const smtp = new SmtpMailer({
        username: 'user@pesu.edu',
        password: 'pass',
      });

      await expect(
        smtp.send({
          to: 'target@pesu.edu',
          subject: 'Test Subject',
          body: 'Hello World',
        })
      ).resolves.toBeUndefined();

      expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('EHLO'));
      expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('AUTH PLAIN'));
      expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('MAIL FROM'));
      expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('RCPT TO'));
      expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('Hello World'));
      expect(mockSocket.end).toHaveBeenCalled();
    });
  });
});
