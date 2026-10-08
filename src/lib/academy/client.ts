import axios, { type AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

export const LOGIN_URL = 'https://www.pesuacademy.com/MAcademy/mobile/mobilelogin/auth';
export const DISPATCHER_URL = 'https://www.pesuacademy.com/MAcademy/mobile/dispatcher';

const ACTION = '27';
const MODE = '1';

export const PROGRAM_MAPPING: Record<string, string> = {
  'B.Tech.': 'Bachelor of Technology',
  'B.Tech': 'Bachelor of Technology',
  'M.Tech.': 'Master of Technology',
  'M.Tech': 'Master of Technology',
  'B.Arch.': 'Bachelor of Architecture',
  'B.Arch': 'Bachelor of Architecture',
  'BBA.': 'Bachelor of Business Administration',
  'BBA': 'Bachelor of Business Administration',
  'MBA.': 'Master of Business Administration',
  'MBA': 'Master of Business Administration',
  'BCA': 'Bachelor of Computer Applications',
  'BCA.': 'Bachelor of Computer Applications',
  'B.Com': 'Bachelor of Commerce',
  'B.Com.': 'Bachelor of Commerce',
  'MCA': 'Master of Computer Applications',
  'MCA.': 'Master of Computer Applications',
  'B.DES': 'Bachelor of Design',
  'B.DES.': 'Bachelor of Design',
};

export const BRANCH_MAPPING: Record<string, string> = {
  'Branch:CSE': 'Computer Science and Engineering',
  'CSE': 'Computer Science and Engineering',
  'Branch:ECE': 'Electronics and Communication Engineering',
  'ECE': 'Electronics and Communication Engineering',
  'Branch:EEE': 'Electrical and Electronics Engineering',
  'EEE': 'Electrical and Electronics Engineering',
  'Branch:ME': 'Mechanical Engineering',
  'ME': 'Mechanical Engineering',
  'Branch:BT': 'Biotechnology',
  'BT': 'Biotechnology',
  'Branch:CSE(AI-ML)': 'Computer Science and Engineering (AI&ML)',
  'CSE(AI-ML)': 'Computer Science and Engineering (AI&ML)',
  'Branch:CSE (AI&ML)': 'Computer Science and Engineering (AI&ML)',
  'CSE (AI&ML)': 'Computer Science and Engineering (AI&ML)',
  'Branch:AIML': 'Computer Science and Engineering (AI&ML)',
  'AIML': 'Computer Science and Engineering (AI&ML)',
  'Branch:CE': 'Civil Engineering',
  'CE': 'Civil Engineering',
  'Branch:CV': 'Civil Engineering',
  'CV': 'Civil Engineering',
};

export class AcademyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcademyAuthError';
  }
}

export interface AcademyProfile {
  name: string;
  prn: string | null;
  srn: string | null;
  program: string | null;
  branch: string | null;
  semester: string | null;
  section: string | null;
  campus: string | null;
  email: string | null;
  phone: string | null;
}

export interface AcademySession {
  token: string;
  accessToken: string | null;
  userId: string | null;
  expiresAt: Date | null;
}

export interface AcademyAuthResult {
  profile: AcademyProfile;
  session: AcademySession;
}

export function semesterFromClass(
  className?: string | null,
  batchClass?: string | null
): string | null {
  for (const val of [className, batchClass]) {
    if (!val) continue;
    const match1 = val.match(/Sem(?:ester)?[-_ ]?(\d+)/i);
    if (match1) return `Sem-${match1[1]}`;
    const match2 = val.match(/(\d+)(?:st|nd|rd|th)?[-_ ]?Sem/i);
    if (match2) return `Sem-${match2[1]}`;
    const match3 = val.match(/\b(\d+)\b/);
    if (match3) return `Sem-${match3[1]}`;
  }
  return null;
}

export function campusFromPrn(prn?: string | null): string | null {
  if (!prn) return null;
  const match = prn.match(/PES(\d)/);
  if (!match) return null;
  const code = parseInt(match[1], 10);
  if (code === 1) return 'RR';
  if (code === 2) return 'EC';
  return null;
}

export function mapProfile(
  mobileObj: Record<string, unknown>,
  username: string,
  profileDetails?: Record<string, unknown> | null
): AcademyProfile {
  const prnStr = (mobileObj.loginId as string) || null;
  const srnRaw = profileDetails?.loginId || mobileObj.loginId || username;
  const srn = (srnRaw as string) || null;

  const nameRaw = (profileDetails?.nameAsInSSLC as string) || (mobileObj.name as string) || '';
  const programRaw = mobileObj.program as string | undefined;
  const branchRaw = mobileObj.branch as string | undefined;

  const emailRaw = (profileDetails?.email as string) || (mobileObj.email as string) || null;
  const phoneRaw = (profileDetails?.mobile as string) || (mobileObj.phone as string) || null;

  const program = programRaw ? PROGRAM_MAPPING[programRaw] || programRaw : null;
  const branch = branchRaw ? BRANCH_MAPPING[branchRaw] || branchRaw : null;

  const className = mobileObj.className as string | undefined;
  const batchClass = mobileObj.batchClass as string | undefined;
  const sectionName = (mobileObj.sectionName as string) || null;

  return {
    name: nameRaw,
    prn: prnStr,
    srn,
    program,
    branch,
    semester: semesterFromClass(className, batchClass),
    section: sectionName,
    campus: campusFromPrn(srn),
    email: emailRaw,
    phone: phoneRaw,
  };
}

export class AcademyClient {
  private client: AxiosInstance;

  constructor(client?: AxiosInstance) {
    if (client) {
      this.client = client;
    } else {
      const jar = new CookieJar();
      this.client = wrapper(
        axios.create({
          jar,
          timeout: 15000,
          headers: {
            'User-Agent': 'okhttp/3.12.1',
          },
        })
      );
    }
  }

  async login(username: string, password: string): Promise<AcademyAuthResult> {
    const formData = new FormData();
    formData.append('userName', username);
    formData.append('password', password);
    formData.append('j_appId', 'YES');
    formData.append('instId', '1,6,7,14');

    let response;
    try {
      response = await this.client.post(LOGIN_URL, formData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AcademyAuthError(`Connection failed: ${msg}`);
    }

    if (response.status !== 200) {
      throw new AcademyAuthError(`Authentication failed: HTTP ${response.status}`);
    }

    let data = response.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        throw new AcademyAuthError('Invalid server response format');
      }
    }

    const mobileObj = data?.mobileJsonObject;
    if (!mobileObj || mobileObj.login !== 'SUCCESS') {
      const errorMsg = mobileObj?.errorMessage || 'Invalid username or password';
      throw new AcademyAuthError(errorMsg);
    }

    const headers = response.headers;
    const token =
      headers?.mobileappauthenticationtoken ||
      headers?.['mobileAppAuthenticationToken'] ||
      '';

    const accessRaw = data.accessToken || mobileObj.accessToken;
    const accessToken = accessRaw ? String(accessRaw) : null;
    const userId = mobileObj.userId ? String(mobileObj.userId) : null;

    if (!token || !accessToken) {
      throw new AcademyAuthError('Incomplete session metadata from authentication');
    }

    const profileDetails = await this.fetchProfileDetails(token, accessToken);

    const profile = mapProfile(mobileObj, username, profileDetails);
    const session: AcademySession = {
      token,
      accessToken,
      userId,
      expiresAt: null,
    };

    return { profile, session };
  }

  private async fetchProfileDetails(
    token: string,
    accessToken: string
  ): Promise<Record<string, unknown>> {
    const formData = new FormData();
    formData.append('action', ACTION);
    formData.append('mode', MODE);
    formData.append('menuId', '11172');

    const headers: Record<string, string> = {
      mobileappauthenticationtoken: token,
      authorization: `Bearer ${accessToken}`,
    };

    try {
      const resp = await this.client.post(DISPATCHER_URL, formData, {
        headers,
        validateStatus: () => true,
      });

      if (resp.status !== 200) {
        throw new AcademyAuthError(`Dispatcher failed: HTTP ${resp.status}`);
      }

      let data = resp.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          throw new AcademyAuthError('Invalid dispatcher response format');
        }
      }

      const studentPhoto = data?.STUDENT_PHOTO as Record<string, unknown> | undefined;
      const nameAsInSSLC = studentPhoto?.nameAsInSSLC;

      if (
        typeof data?.MESSAGE === 'string' &&
        data.MESSAGE.includes('SUCCESS') &&
        studentPhoto &&
        typeof nameAsInSSLC === 'string' &&
        nameAsInSSLC.trim() !== ''
      ) {
        return studentPhoto;
      }

      // Accounts without a student SSLC record (e.g. faculty, staff, library) are not supported
      throw new AcademyAuthError('Only student accounts are supported');
    } catch (err) {
      if (err instanceof AcademyAuthError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new AcademyAuthError(`Dispatcher connection failed: ${msg}`);
    }
  }
}
