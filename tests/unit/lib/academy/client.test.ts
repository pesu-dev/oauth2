import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  AcademyClient,
  mapProfile,
  campusFromPrn,
  semesterFromClass,
} from '@/lib/academy/client';

describe('PESU Academy Client & Profile Mapping', () => {
  describe('Profile helper mappings', () => {
    it('maps campus from PRN correctly', () => {
      expect(campusFromPrn('PES1UG20CS001')).toBe('RR');
      expect(campusFromPrn('PES2UG20CS001')).toBe('EC');
      expect(campusFromPrn('PES3UG20CS001')).toBeNull();
      expect(campusFromPrn('OTHER123')).toBeNull();
      expect(campusFromPrn(undefined)).toBeNull();
    });

    it('extracts semester from class names', () => {
      expect(semesterFromClass('Sem-6', undefined)).toBe('Sem-6');
      expect(semesterFromClass(undefined, 'Semester 4')).toBe('Sem-4');
      expect(semesterFromClass('6th Sem', undefined)).toBe('Sem-6');
      expect(semesterFromClass('Batch 5', undefined)).toBe('Sem-5');
      expect(semesterFromClass('unknown', undefined)).toBeNull();
    });

    it('maps profile with fallback and enrichment', () => {
      const mobileObj = {
        loginId: 'PES1UG20CS001',
        name: 'John Doe',
        program: 'B.Tech.',
        branch: 'CSE',
        className: 'Sem-6',
        sectionName: 'A',
      };
      const enrichedDetails = {
        nameAsInSSLC: 'JOHN DOE OFFICIAL',
        loginId: 'PES1202000001',
        email: 'john@pesu.pes.edu',
        mobile: '9876543210',
      };

      const profile = mapProfile(mobileObj, 'PES1202000001', enrichedDetails);
      expect(profile.name).toBe('JOHN DOE OFFICIAL');
      expect(profile.prn).toBe('PES1UG20CS001');
      expect(profile.srn).toBe('PES1202000001');
      expect(profile.program).toBe('Bachelor of Technology');
      expect(profile.branch).toBe('Computer Science and Engineering');
      expect(profile.semester).toBe('Sem-6');
      expect(profile.campus).toBe('RR');
      expect(profile.email).toBe('john@pesu.pes.edu');
      expect(profile.phone).toBe('9876543210');
    });

    it('falls back to raw program and branch when not present in mapping table', () => {
      const mobileObj = {
        loginId: 'PES1UG20CS001',
        name: 'John Doe',
        program: 'Quantum Computing',
        branch: 'Astrophysics',
      };
      const profile = mapProfile(mobileObj, 'PES1202000001', null);
      expect(profile.program).toBe('Quantum Computing');
      expect(profile.branch).toBe('Astrophysics');
    });

    it('maps empty profile with total fallbacks to username and nulls', () => {
      const profile = mapProfile({}, 'fallback_usr', null);
      expect(profile.prn).toBeNull();
      expect(profile.srn).toBe('fallback_usr');
      expect(profile.name).toBe('');
      expect(profile.email).toBeNull();
      expect(profile.phone).toBeNull();
      expect(profile.program).toBeNull();
      expect(profile.branch).toBeNull();
    });
  });

  describe('AcademyClient authentication', () => {
    it('authenticates successfully and extracts session + profile', async () => {
      const mockPost = vi.fn();

      // First call to auth
      mockPost.mockResolvedValueOnce({
        status: 200,
        headers: {
          mobileappauthenticationtoken: 'auth-token-xyz',
        },
        data: {
          mobileJsonObject: {
            login: 'SUCCESS',
            loginId: 'PES1UG20CS001',
            name: 'Test Student',
            userId: '12345',
            accessToken: 'token-abc',
          },
        },
      });

      // Second call to dispatcher
      mockPost.mockResolvedValueOnce({
        status: 200,
        data: {
          MESSAGE: 'SUCCESS',
          STUDENT_PHOTO: {
            nameAsInSSLC: 'TEST STUDENT',
            loginId: 'PES1202000001',
            email: 'test@pes.edu',
          },
        },
      });

      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);
      const result = await client.login('PES1UG20CS001', 'password123');

      expect(result.profile.prn).toBe('PES1UG20CS001');
      expect(result.profile.srn).toBe('PES1202000001');
      expect(result.session.token).toBe('auth-token-xyz');
      expect(result.session.userId).toBe('12345');
    });

    it('throws AcademyAuthError on invalid credentials with custom or default message', async () => {
      const mockPost = vi.fn();

      // Custom errorMessage
      mockPost.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          mobileJsonObject: {
            login: 'FAILURE',
            errorMessage: 'Account temporarily locked',
          },
        },
      });

      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);
      await expect(client.login('PES1UG20CS001', 'wrong')).rejects.toThrow(
        'Account temporarily locked'
      );

      // Default error message when errorMessage is undefined
      mockPost.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          mobileJsonObject: {
            login: 'FAILURE',
          },
        },
      });
      await expect(client.login('PES1UG20CS001', 'wrong')).rejects.toThrow(
        'Invalid username or password'
      );

      // Missing mobileJsonObject entirely
      mockPost.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {},
      });
      await expect(client.login('PES1UG20CS001', 'wrong')).rejects.toThrow(
        'Invalid username or password'
      );
    });

    it('throws AcademyAuthError on invalid JSON server response format', async () => {
      const mockPost = vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: 'not a json string at all {[[[',
      });

      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);
      await expect(client.login('PES1UG20CS001', 'password')).rejects.toThrow(
        'Invalid server response format'
      );
    });

    it('supports stringified JSON data and camelCase mobileAppAuthenticationToken header', async () => {
      const mockPost = vi.fn();
      mockPost.mockResolvedValueOnce({
        status: 200,
        headers: {
          mobileAppAuthenticationToken: 'camel-token',
        },
        data: JSON.stringify({
          mobileJsonObject: {
            login: 'SUCCESS',
            loginId: 'PES1UG20CS001',
            name: 'Test Student',
          },
        }),
      });

      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);
      const res = await client.login('PES1UG20CS001', 'pass');
      expect(res.session.token).toBe('camel-token');
      expect(res.profile.prn).toBe('PES1UG20CS001');
    });

    it('handles fetchProfileDetails stringified JSON and error fallbacks', async () => {
      const mockPost = vi.fn();

      // 1. Success with stringified JSON in dispatcher
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
              accessToken: 'acc',
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: JSON.stringify({
            MESSAGE: 'SUCCESS',
            STUDENT_PHOTO: { nameAsInSSLC: 'STRINGIFIED NAME' },
          }),
        });

      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);
      const res1 = await client.login('PES1UG20CS001', 'pass');
      expect(res1.profile.name).toBe('STRINGIFIED NAME');

      // 2. Dispatcher returns invalid JSON string
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
              accessToken: 'acc',
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: 'invalid json {{{',
        });

      const res2 = await client.login('PES1UG20CS001', 'pass');
      expect(res2.profile.name).toBe('Test Student');

      // 3. Dispatcher call fails / throws
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
            },
          },
        })
        .mockRejectedValueOnce(new Error('Network failure'));

      const res3 = await client.login('PES1UG20CS001', 'pass');
      expect(res3.profile.name).toBe('Test Student');
    });

    it('handles non-Error rejection and non-200 HTTP status', async () => {
      const mockPost = vi.fn();
      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);

      // Non-Error rejection
      mockPost.mockRejectedValueOnce('raw-network-error');
      await expect(client.login('PES1UG20CS001', 'pass')).rejects.toThrow('Connection failed: raw-network-error');

      // Error rejection
      mockPost.mockRejectedValueOnce(new Error('Connection timed out'));
      await expect(client.login('PES1UG20CS001', 'pass')).rejects.toThrow('Connection failed: Connection timed out');

      // Non-200 HTTP status
      mockPost.mockResolvedValueOnce({ status: 502, data: {} });
      await expect(client.login('PES1UG20CS001', 'pass')).rejects.toThrow('Authentication failed: HTTP 502');

      // Dispatcher returns data with MESSAGE !== SUCCESS
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
              accessToken: 'acc',
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: { MESSAGE: 'FAILURE_RECORD_NOT_FOUND' },
        });

      const res = await client.login('PES1UG20CS001', 'pass');
      expect(res.profile.name).toBe('Test Student');

      // Dispatcher post rejects with error, hitting outer catch block
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
              accessToken: 'acc',
            },
          },
        })
        .mockRejectedValueOnce(new Error('Dispatcher network timeout'));

      const resCatch = await client.login('PES1UG20CS001', 'pass');
      expect(resCatch.profile.name).toBe('Test Student');

      // Dispatcher returns status !== 200 (e.g. 500)
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            accessToken: 'top-level-token',
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
            },
          },
        })
        .mockResolvedValueOnce({
          status: 500,
          data: {},
        });

      const resStatus500 = await client.login('PES1UG20CS001', 'pass');
      expect(resStatus500.session.accessToken).toBe('top-level-token');
      expect(resStatus500.profile.name).toBe('Test Student');

      // Dispatcher returns SUCCESS but STUDENT_PHOTO is falsy
      mockPost
        .mockResolvedValueOnce({
          status: 200,
          headers: { mobileappauthenticationtoken: 'tok' },
          data: {
            mobileJsonObject: {
              login: 'SUCCESS',
              loginId: 'PES1UG20CS001',
              name: 'Test Student',
              userId: '123',
              accessToken: 'acc',
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            MESSAGE: 'SUCCESS',
            STUDENT_PHOTO: null,
          },
        });

      const resNullPhoto = await client.login('PES1UG20CS001', 'pass');
      expect(resNullPhoto.profile.name).toBe('Test Student');
    });

    it('initializes with default CookieJar and AxiosInstance when no client is passed', () => {
      const client = new AcademyClient();
      expect(client).toBeInstanceOf(AcademyClient);
    });
  });
});
