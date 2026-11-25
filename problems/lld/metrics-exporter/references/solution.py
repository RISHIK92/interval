from __future__ import annotations

NAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")
VALUE_CHARS = NAME_CHARS | set("-.")
BOUNDS = [10, 100, 1000]

# A sample is one exported number: its name, the tags it adds to its series' tags, and
# its value. A metric kind decides its samples; a format decides how one is written.
Sample = tuple[str, list[tuple[str, str]], int]


def _word(text: str, allowed: set[str]) -> None:
    if text == "" or any(c not in allowed for c in text):
        raise ValueError("a name, tag key or tag value with a character it can't have")


class Counter:
    kind = "counter"

    def __init__(self) -> None:
        self.total = 0

    def add(self, by: int) -> None:
        self.total += by

    def samples(self, name: str) -> list[Sample]:
        return [(name, [], self.total)]


class Histogram:
    kind = "histogram"

    def __init__(self) -> None:
        self.buckets = [0 for _ in BOUNDS]
        self.count = 0
        self.sum = 0

    def add(self, val: int) -> None:
        for i, bound in enumerate(BOUNDS):
            if val <= bound:
                self.buckets[i] += 1
        self.count += 1
        self.sum += val

    def samples(self, name: str) -> list[Sample]:
        out: list[Sample] = []
        for i, bound in enumerate(BOUNDS):
            out.append((name + "_bucket", [("le", str(bound))], self.buckets[i]))
        out.append((name + "_bucket", [("le", "+Inf")], self.count))
        out.append((name + "_sum", [], self.sum))
        out.append((name + "_count", [], self.count))
        return out


class Gauge:
    kind = "gauge"
    # Set by the call that creates the series: a gauge has no value before its first.
    level: int

    def add(self, val: int) -> None:
        self.level = val

    def samples(self, name: str) -> list[Sample]:
        return [(name, [], self.level)]


class PrometheusFormat:
    def header(self, name: str, kind: str) -> list[str]:
        return [f"# TYPE {name} {kind}"]

    def line(
        self, sample: str, tags: list[tuple[str, str]], value: int, kind: str
    ) -> str:
        if not tags:
            return f"{sample} {value}"
        return (
            sample + "{" + ",".join(f'{k}="{v}"' for k, v in tags) + "} " + str(value)
        )


class StatsdFormat:
    def header(self, name: str, kind: str) -> list[str]:
        return []

    def line(
        self, sample: str, tags: list[tuple[str, str]], value: int, kind: str
    ) -> str:
        text = f"{sample}:{value}|" + ("g" if kind == "gauge" else "c")
        if tags:
            text += "|#" + ",".join(f"{k}:{v}" for k, v in tags)
        return text


FORMATS = {"prometheus": PrometheusFormat, "statsd": StatsdFormat}


class MetricsExporter:
    """The bridge: metric kinds (counter, histogram) and export formats vary on their
    own. Each series keeps its numbers once; scraping asks the kind for its samples and
    hands each one to whichever format is current."""

    def __init__(self, format: str) -> None:
        self._format = self._pick(format)
        self._kinds: dict[str, str] = {}
        # name -> tag text -> (sorted tags, the series)
        self._series: dict[
            str, dict[str, tuple[list[tuple[str, str]], Counter | Histogram | Gauge]]
        ] = {}

    def counter(self, name: str, by: int, tags: dict[str, str]) -> None:
        if by < 0:
            raise ValueError("a counter only goes up")
        self._series_for(name, tags, Counter).add(by)

    def observe(self, name: str, val: int, tags: dict[str, str]) -> None:
        if "le" in tags:
            raise ValueError("le is the histogram's own tag")
        self._series_for(name, tags, Histogram).add(val)

    def scrape(self) -> list[str]:
        out: list[str] = []
        for name in sorted(self._series):
            out += self._format.header(name, self._kinds[name])
            series = self._series[name]
            for key in sorted(series):
                tags, metric = series[key]
                for sample, extra, value in metric.samples(name):
                    out.append(
                        self._format.line(sample, tags + extra, value, metric.kind)
                    )
        return out

    def switchFormat(self, format: str) -> None:
        self._format = self._pick(format)

    # The extension round: a third kind. Of the formats, only StatsD's letter changed.
    def gauge(self, name: str, val: int, tags: dict[str, str]) -> None:
        self._series_for(name, tags, Gauge).add(val)

    @staticmethod
    def _pick(format: str) -> PrometheusFormat | StatsdFormat:
        if format not in FORMATS:
            raise ValueError("unknown format")
        return FORMATS[format]()

    def _series_for(
        self,
        name: str,
        tags: dict[str, str],
        kind: type[Counter] | type[Histogram] | type[Gauge],
    ) -> Counter | Histogram | Gauge:
        _word(name, NAME_CHARS)
        for key, value in tags.items():
            _word(key, NAME_CHARS)
            _word(value, VALUE_CHARS)
        if self._kinds.get(name, kind.kind) != kind.kind:
            raise ValueError("the name belongs to another kind")
        ordered = sorted(tags.items())
        key = ",".join(f"{k}={v}" for k, v in ordered)
        series = self._series.setdefault(name, {})
        if key not in series:
            series[key] = (ordered, kind())
        self._kinds[name] = kind.kind
        return series[key][1]
