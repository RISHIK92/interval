"""The owner's hard ceiling on model price (2026-10-27): no model above $0.80 per
million output tokens may run. Each LLM adapter checks before any call and refuses a
model it can't price, so a typo or an unlisted model fails closed."""

from decimal import Decimal

from interval_jobs.ports import ModelError

MAX_OUTPUT_USD_PER_MILLION = Decimal("0.80")


def refuse_over_cap(
    provider: str, model: str, output_usd_per_million: Decimal | None
) -> None:
    if output_usd_per_million is None:
        raise ModelError(
            f"{provider} {model}: no output price known, so refused "
            f"(cap ${MAX_OUTPUT_USD_PER_MILLION} per million output tokens)"
        )
    if output_usd_per_million > MAX_OUTPUT_USD_PER_MILLION:
        raise ModelError(
            f"{provider} {model}: ${output_usd_per_million} per million output tokens "
            f"is over the cap of ${MAX_OUTPUT_USD_PER_MILLION}"
        )
