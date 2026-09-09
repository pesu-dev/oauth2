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
      expect(campusFromPrn('OTHER123')).toBeNull();
      expect(campusFromPrn(undefined)).toBeNull();
    });

    it('extracts semester from class names', () => {
      expect(semesterFromClass('Sem-6', undefined)).toBe('Sem-6');
      expect(semesterFromClass(undefined, 'Semester 4')).toBe('Sem-4');
      expect(semesterFromClass('6th Sem', undefined)).toBe('Sem-6');
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

    it('throws AcademyAuthError on invalid credentials', async () => {
      const mockPost = vi.fn();

      mockPost.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          mobileJsonObject: {
            login: 'FAILURE',
            errorMessage: 'Invalid username or password',
          },
        },
      });

      const client = new AcademyClient({ post: mockPost } as unknown as AxiosInstance);
      await expect(client.login('PES1UG20CS001', 'wrong')).rejects.toThrow(
        'Invalid username or password'
      );
    });
  });
});
