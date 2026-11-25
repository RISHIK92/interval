from __future__ import annotations


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("names and expressions are not empty")


class Dashboards:
    """Queries are aggregated: panels hold only a query's name, and a query outlives
    every dashboard. Panels are composed: they live inside their dashboard's map."""

    def __init__(self) -> None:
        self._queries: dict[str, str] = {}
        self._dashboards: dict[str, dict[str, str]] = {}

    def _panels(self, dashboard: str) -> dict[str, str]:
        _named(dashboard)
        panels = self._dashboards.get(dashboard)
        if panels is None:
            raise ValueError("unknown dashboard")
        return panels

    def saveQuery(self, name: str, expr: str) -> None:
        _named(name, expr)
        if name in self._queries:
            raise ValueError("query already saved")
        self._queries[name] = expr

    def addPanel(self, dashboard: str, panel: str, query: str) -> bool:
        _named(dashboard, panel, query)
        if query not in self._queries:
            return False
        panels = self._dashboards.get(dashboard, {})
        if panel in panels:
            return False
        panels[panel] = query
        self._dashboards[dashboard] = panels
        return True

    def dropDashboard(self, dashboard: str) -> int:
        panels = self._panels(dashboard)
        del self._dashboards[dashboard]
        return len(panels)

    def dropQuery(self, name: str) -> bool:
        _named(name)
        if name not in self._queries or self.usage(name):
            return False
        del self._queries[name]
        return True

    def usage(self, query: str) -> list[str]:
        _named(query)
        if query not in self._queries:
            raise ValueError("unknown query")
        return sorted(
            f"{dashboard}/{panel}"
            for dashboard, panels in self._dashboards.items()
            for panel, used in panels.items()
            if used == query
        )

    # The extension round: a copy owns new panels that share the same queries.
    def duplicate(self, dashboard: str, newName: str) -> bool:
        panels = self._panels(dashboard)
        _named(newName)
        if newName in self._dashboards:
            return False
        self._dashboards[newName] = dict(panels)
        return True
