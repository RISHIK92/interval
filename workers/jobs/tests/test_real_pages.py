"""Heading-preserving extraction on pages from six seed sources (ING-1, P1-W2-S05).

The fixtures are real pages fetched 2026-10-26 and reduced by fixtures/real/reduce.py:
markup and headings kept, prose scrambled. The expected trees were read off each page's
own markup: the article's headings, levels and publisher ids, and nothing from the
navigation, author box, tag list, related-post cards or revision log around it.
"""

import pytest

from interval_jobs.adapters.trafilatura_extractor import extract_sections

from .conftest import fixture_bytes

type Tree = list[tuple[str | None, int | None, str | None]]

INTRO: Tree = [(None, None, None)]

PAGES: dict[str, tuple[str, Tree]] = {
    "cloudflare": (
        "Origin Range Requests: Serving large files without range-request tuning",
        INTRO
        + [
            (heading, 2, None)
            for heading in (
                "A request for part of a file",
                "The range-size problem",
                "Fixed-size cache chunks",
                "Coordinating cached and in-flight data",
                "Validate before composing",
                "What changed in production",
                "Getting started",
            )
        ],
    ),
    "brooker": ("Animations for System Builders: Metastability and Lost Writes", INTRO),
    "github": (
        "The bridge to agent-scale Git infrastructure",
        [
            *INTRO,
            ("How we got here", 2, "h-how-we-got-here"),
            ("No repository left behind", 2, "h-no-repository-left-behind"),
            ("Scaling reads on their own", 2, "h-scaling-reads-on-their-own"),
            ("What comes next", 2, "h-what-comes-next"),
        ],
    ),
    "planetscale": (
        "Shard design doesn't start from your tables",
        [
            *INTRO,
            ("Co-locating related tables", 2, "co-locating-related-tables"),
            ("Reference tables", 2, "reference-tables"),
            ("Differently sharded tables", 2, "differently-sharded-tables"),
            ("SQL expressions in shard indexes", 3, "sql-expressions-in-shard-indexes"),
            ("Beyond xxhash", 2, "beyond-xxhash"),
            ("Queries without shard keys", 2, "queries-without-shard-keys"),
            ("Changing data placement", 2, "changing-data-placement"),
            ("Putting it all together", 2, "putting-it-all-together"),
            (
                "Need help designing your shard groups?",
                2,
                "need-help-designing-your-shard-groups",
            ),
        ],
    ),
    "jvns": (
        "Replacing the old battery on rechargeable bike lights",
        [
            *INTRO,
            ("step 1: cut it open", 3, "step-1-cut-it-open"),
            ("step 2: remove the screws", 3, "step-2-remove-the-screws"),
            (
                "step 3: get the circuit board out",
                3,
                "step-3-get-the-circuit-board-out",
            ),
            ("step 4: desolder the battery", 3, "step-4-desolder-the-battery"),
            ("step 5: identify the battery", 3, "step-5-identify-the-battery"),
            ("step 6: buy the battery", 3, "step-6-buy-the-battery"),
            (
                "step 7: solder the new batteries in and glue it back together",
                3,
                "step-7-solder-the-new-batteries-in-and-glue-it-back-together",
            ),
            ("it works!", 3, "it-works"),
        ],
    ),
    "fowler": (
        "When Software Meets Hardware",
        INTRO
        + [
            (heading, 2, anchor)
            for heading, anchor in (
                (
                    "Learn by building an experimentation environment",
                    "LearnByBuildingAnExperimentationEnvironment",
                ),
                (
                    "Consider the physical world part of the development lifecycle",
                    "ConsiderThePhysicalWorldPartOfTheDevelopmentLifecycle",
                ),
                (
                    "Every device must be able to explain itself",
                    "EveryDeviceMustBeAbleToExplainItself",
                ),
                (
                    "Design interfaces for engineers as deliberately as interfaces "
                    "for users.",
                    "DesignInterfacesForEngineersAsDeliberatelyAsInterfacesForUsers.",
                ),
                (
                    "Simulate what is expensive to reproduce physically",
                    "SimulateWhatIsExpensiveToReproducePhysically",
                ),
                (
                    "Design for disconnection, not just connection.",
                    "DesignForDisconnectionNotJustConnection.",
                ),
                (
                    "Treat energy consumption as a software design concern.",
                    "TreatEnergyConsumptionAsASoftwareDesignConcern.",
                ),
                (
                    "Design deployment and recovery together.",
                    "DesignDeploymentAndRecoveryTogether.",
                ),
                (
                    "Optimize the engineering process for confidence at scale.",
                    "OptimizeTheEngineeringProcessForConfidenceAtScale.",
                ),
                (
                    "Design observability for the fleet, not just the device.",
                    "DesignObservabilityForTheFleetNotJustTheDevice.",
                ),
                (
                    "The engineering environment became part of the system",
                    "TheEngineeringEnvironmentBecamePartOfTheSystem",
                ),
                (
                    "Use AI to shorten the learning loop, not just the coding loop.",
                    "UseAiToShortenTheLearningLoopNotJustTheCodingLoop.",
                ),
                (
                    "Capture discoveries, not just decisions.",
                    "CaptureDiscoveriesNotJustDecisions.",
                ),
                (
                    "The principles stayed, the defaults changed",
                    "ThePrinciplesStayedTheDefaultsChanged",
                ),
                ("Why call them sensible defaults?", "WhyCallThemSensibleDefaults"),
                ("Acknowledgments", "Acknowledgments"),
            )
        ],
    ),
}


@pytest.mark.parametrize("name", sorted(PAGES))
def test_the_heading_tree_and_ids_match_the_publishers_page(name: str) -> None:
    title, expected = PAGES[name]
    sections = extract_sections(fixture_bytes(f"real/{name}.html"), "utf-8", title)
    assert [(s.heading, s.level, s.anchor_id) for s in sections] == expected
    assert all(s.word_count > 0 for s in sections)
