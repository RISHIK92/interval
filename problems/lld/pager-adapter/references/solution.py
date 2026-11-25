from __future__ import annotations

# The incident API's severities as the legacy pager's levels, and back: five levels fold
# into three severities.
TO_LEVEL = {"sev1": "1", "sev2": "3", "sev3": "5"}
TO_SEVERITY = {"1": "sev1", "2": "sev1", "3": "sev2", "4": "sev3", "5": "sev3"}
MAX_CODE = 9999


class Page:
    def __init__(self, team: str, code: str) -> None:
        self.team = team
        self.code = code
        self.acked = False


class PagerAdapter:
    """Lets the incident API (team names, sev1 to sev3) drive a legacy pager (numeric team
    codes, levels 1 to 5): pages go out as legacy lines, and the pager's acknowledgements
    come back as the API's words. Numbers are kept as the text the pager sees."""

    def __init__(self, teamCodes: dict[str, int]) -> None:
        self._codes: dict[str, str] = {}
        for team, code in teamCodes.items():
            if team == "" or not 1 <= code <= MAX_CODE:
                raise ValueError("bad team or code")
            self._codes[team] = str(code)
        if len(set(self._codes.values())) != len(self._codes):
            raise ValueError("two teams share a code")
        self._pages: dict[str, Page] = {}

    def page(self, team: str, severity: str, summary: str) -> str:
        code = self._codes.get(team)
        level = TO_LEVEL.get(severity)
        if code is None or level is None or summary == "":
            raise ValueError("unknown team or severity, or no summary")
        number = str(len(self._pages) + 1)
        self._pages[number] = Page(team, code)
        return f"PAGE {number} {code} {level} {summary}"

    def ack(self, legacyLine: str) -> str | None:
        if legacyLine == "":
            raise ValueError("empty line")
        fields = legacyLine.split(" ")
        if len(fields) != 4 or fields[0] != "ACK":
            return None
        page = self._pages.get(fields[1])
        severity = TO_SEVERITY.get(fields[3])
        if page is None or page.acked or page.code != fields[2] or severity is None:
            return None
        page.acked = True
        return f"{page.team} acked page {fields[1]} at {severity}"

    def pages(self) -> int:
        return len(self._pages)
