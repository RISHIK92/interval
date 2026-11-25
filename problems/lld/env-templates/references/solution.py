from __future__ import annotations


def _filled(text: str) -> None:
    if text == "":
        raise ValueError("names, keys and values are not empty")


class _Environment:
    """A prototype: anything made from it is a copy that shares no state with it. It
    remembers the variables it started with, so it can tell what changed since."""

    def __init__(self, variables: dict[str, str]) -> None:
        self.variables = dict(variables)
        self.started = dict(variables)

    def copy(self) -> _Environment:
        return _Environment(self.variables)


class EnvTemplates:
    def __init__(self) -> None:
        self._templates: dict[str, _Environment] = {}
        self._envs: dict[str, _Environment] = {}

    def _env(self, env: str) -> _Environment:
        found = self._envs.get(env)
        if found is None:
            raise KeyError("unknown environment")
        return found

    def define(self, name: str, vars: dict[str, str]) -> None:
        _filled(name)
        for key, value in vars.items():
            _filled(key)
            _filled(value)
        self._templates[name] = _Environment(vars)

    def fork(self, base: str, env: str) -> bool:
        _filled(env)
        template = self._templates.get(base)
        if template is None:
            raise KeyError("unknown template")
        if env in self._envs:
            return False
        self._envs[env] = template.copy()
        return True

    def setVar(self, env: str, key: str, value: str) -> bool:
        found = self._env(env)
        _filled(key)
        _filled(value)
        if found.variables.get(key) == value:
            return False
        found.variables[key] = value
        return True

    def vars(self, env: str) -> dict[str, str]:
        return dict(self._env(env).variables)

    # The extension round: what an environment changed since it was forked.
    def diff(self, env: str) -> list[str]:
        found = self._env(env)
        out: list[str] = []
        for key in sorted(found.variables):
            value = found.variables[key]
            if key not in found.started:
                out.append(f"+{key}={value}")
            elif found.started[key] != value:
                out.append(f"~{key}={value}")
        return out
