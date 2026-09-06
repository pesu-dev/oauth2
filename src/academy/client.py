"""httpx adapter for PESU Academy mobile login + profile mapping."""

from __future__ import annotations

import json
import re

import httpx

from src.academy.models import (
    AcademyAuthError,
    AcademyAuthResult,
    AcademyProfile,
    AcademySession,
)

LOGIN_URL = "https://www.pesuacademy.com/MAcademy/mobile/mobilelogin/auth"
DISPATCHER_URL = "https://www.pesuacademy.com/MAcademy/mobile/dispatcher"

# Dispatcher admin search: resolve official SRN / nameAsInSSLC after login.
_DISPATCHER_ACTION_ADMIN = "27"
_DISPATCHER_MODE_SEARCH_BY_SRN = "1"

PROGRAM_MAPPING: dict[str, str] = {
    "B.Tech.": "Bachelor of Technology",
    "B.Tech": "Bachelor of Technology",
    "M.Tech.": "Master of Technology",
    "M.Tech": "Master of Technology",
    "B.Arch.": "Bachelor of Architecture",
    "B.Arch": "Bachelor of Architecture",
    "BBA.": "Bachelor of Business Administration",
    "BBA": "Bachelor of Business Administration",
    "MBA.": "Master of Business Administration",
    "MBA": "Master of Business Administration",
    "BCA": "Bachelor of Computer Applications",
    "BCA.": "Bachelor of Computer Applications",
    "B.Com": "Bachelor of Commerce",
    "B.Com.": "Bachelor of Commerce",
    "MCA": "Master of Computer Applications",
    "MCA.": "Master of Computer Applications",
    "B.DES": "Bachelor of Design",
    "B.DES.": "Bachelor of Design",
}

BRANCH_MAPPING: dict[str, str] = {
    "Branch:CSE": "Computer Science and Engineering",
    "CSE": "Computer Science and Engineering",
    "Branch:ECE": "Electronics and Communication Engineering",
    "ECE": "Electronics and Communication Engineering",
    "Branch:EEE": "Electrical and Electronics Engineering",
    "EEE": "Electrical and Electronics Engineering",
    "Branch:ME": "Mechanical Engineering",
    "ME": "Mechanical Engineering",
    "Branch:BT": "Biotechnology",
    "BT": "Biotechnology",
    "Branch:CSE(AI-ML)": "Computer Science and Engineering (AI&ML)",
    "CSE(AI-ML)": "Computer Science and Engineering (AI&ML)",
    "Branch:CSE (AI&ML)": "Computer Science and Engineering (AI&ML)",
    "CSE (AI&ML)": "Computer Science and Engineering (AI&ML)",
    "Branch:AIML": "Computer Science and Engineering (AI&ML)",
    "AIML": "Computer Science and Engineering (AI&ML)",
    "Branch:CE": "Civil Engineering",
    "CE": "Civil Engineering",
    "Branch:CV": "Civil Engineering",
    "CV": "Civil Engineering",
}


def _semester_from_class(class_name: str | None, batch_class: str | None) -> str | None:
    for val in (class_name, batch_class):
        if not val:
            continue
        if match := re.search(r"Sem(?:ester)?[-_ ]?(\d+)", val, re.IGNORECASE):
            return f"Sem-{match.group(1)}"
        if match := re.search(r"(\d+)(?:st|nd|rd|th)?[-_ ]?Sem", val, re.IGNORECASE):
            return f"Sem-{match.group(1)}"
        if match := re.search(r"\b(\d+)\b", val):
            return f"Sem-{match.group(1)}"
    return None


def _campus_from_prn(prn: str | None) -> str | None:
    if not prn:
        return None
    match = re.match(r"PES(\d)", prn)
    if not match:
        return None
    code = int(match.group(1))
    if code == 1:
        return "RR"
    if code == 2:
        return "EC"
    return None


def _parse_json_payload(response: httpx.Response) -> object:
    try:
        data: object = response.json()
    except json.JSONDecodeError as exc:
        raise AcademyAuthError("Authentication failed: Invalid JSON response from server") from exc
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise AcademyAuthError("Authentication failed: Invalid nested JSON response") from exc
    return data


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _map_profile(
    mobile_obj: dict[str, object],
    *,
    username: str,
    profile_details: dict[str, object] | None,
) -> AcademyProfile:
    prn_str = _optional_str(mobile_obj.get("loginId"))
    srn_raw: object = None
    if profile_details is not None:
        srn_raw = profile_details.get("loginId")
    if srn_raw is None:
        srn_raw = mobile_obj.get("loginId") or username
    srn = _optional_str(srn_raw)

    name_raw: object = None
    if profile_details is not None:
        name_raw = profile_details.get("nameAsInSSLC")
    if name_raw is None:
        name_raw = mobile_obj.get("name") or ""

    program_raw = mobile_obj.get("program")
    branch_raw = mobile_obj.get("branch")

    email_raw: object = None
    phone_raw: object = None
    if profile_details is not None:
        email_raw = profile_details.get("email")
        phone_raw = profile_details.get("mobile")
    if email_raw is None:
        email_raw = mobile_obj.get("email")
    if phone_raw is None:
        phone_raw = mobile_obj.get("phone")

    program = None if program_raw is None else PROGRAM_MAPPING.get(str(program_raw), str(program_raw))
    branch = None if branch_raw is None else BRANCH_MAPPING.get(str(branch_raw), str(branch_raw))

    class_name = mobile_obj.get("className")
    batch_class = mobile_obj.get("batchClass")
    section_name = mobile_obj.get("sectionName")

    return AcademyProfile(
        name=str(name_raw),
        prn=prn_str,
        srn=srn,
        program=program,
        branch=branch,
        semester=_semester_from_class(
            class_name if isinstance(class_name, str) else None,
            batch_class if isinstance(batch_class, str) else None,
        ),
        section=section_name if isinstance(section_name, str) else None,
        campus=_campus_from_prn(prn_str),
        email=_optional_str(email_raw),
        phone=_optional_str(phone_raw),
    )


class HttpxAcademyClient:
    """Academy login via mobilelogin/auth; profile enrichment via dispatcher admin search."""

    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._http.aclose()

    async def login(self, username: str, password: str) -> AcademyAuthResult:
        """Authenticate and map profile fields. Raises AcademyAuthError on failure."""
        files = {
            "userName": (None, username),
            "password": (None, password),
            "j_appId": (None, "YES"),
            "instId": (None, "1,6,7,14"),
        }
        try:
            response = await self._http.post(LOGIN_URL, files=files)
        except httpx.HTTPError as exc:
            raise AcademyAuthError(f"Connection failed: {exc}") from exc

        if response.status_code != 200:
            raise AcademyAuthError(
                f"Authentication failed: Server returned status code {response.status_code}",
            )

        data = _parse_json_payload(response)
        if not isinstance(data, dict):
            raise AcademyAuthError("Authentication failed: Unexpected response shape")

        mobile_obj = data.get("mobileJsonObject")
        if not isinstance(mobile_obj, dict) or mobile_obj.get("login") != "SUCCESS":
            error_msg = mobile_obj.get("errorMessage") if isinstance(mobile_obj, dict) else None
            raise AcademyAuthError(
                str(error_msg) if error_msg else "Invalid username or password",
            )

        token = response.headers.get("mobileAppAuthenticationToken") or ""
        access_raw = data.get("accessToken") or mobile_obj.get("accessToken")
        access_token = _optional_str(access_raw)
        user_id = _optional_str(mobile_obj.get("userId")) or None

        profile_details = None
        if token and user_id and access_token:
            profile_details = await self._fetch_profile_details(token, access_token, user_id)

        profile = _map_profile(mobile_obj, username=username, profile_details=profile_details)
        session = AcademySession(
            token=token,
            access_token=access_token,
            user_id=user_id,
            expires_at=None,
        )
        return AcademyAuthResult(profile=profile, session=session)

    async def _fetch_profile_details(
        self,
        token: str,
        access_token: str,
        user_id: str,
    ) -> dict[str, object] | None:
        headers = {
            "mobileappauthenticationtoken": token,
            "authorization": f"Bearer {access_token}",
        }
        files = {
            "action": (None, _DISPATCHER_ACTION_ADMIN),
            "mode": (None, _DISPATCHER_MODE_SEARCH_BY_SRN),
            "userId": (None, user_id),
            "searchUserId": (None, user_id),
        }
        try:
            resp = await self._http.post(DISPATCHER_URL, headers=headers, files=files)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None
        try:
            data = _parse_json_payload(resp)
        except AcademyAuthError:
            return None
        if not isinstance(data, dict):
            return None
        msg = data.get("MESSAGE")
        if isinstance(msg, str) and "SUCCESS" in msg:
            photo = data.get("STUDENT_PHOTO")
            if isinstance(photo, dict):
                return photo
        return None
