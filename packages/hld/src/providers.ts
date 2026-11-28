import {
  CHANNEL_NAMES,
  type ChannelId,
  PROVIDER_NAMES,
  type ProviderId,
} from "./catalog";
import type { Design, DesignNode } from "./design";
import type { HldProblem } from "./problem";
import {
  type ProviderPrice,
  REGION_NAMES,
  type SpecVersion,
  specVersion,
} from "./spec";

// ADR-0053: the provider and channel a player picks on an external provider, where the
// problem offers a choice, and what the pick costs in the problem's region. Pure, like
// the simulator it feeds: the canvas, the simulator and the spec sheet read the same
// prices.

type Offer = NonNullable<HldProblem["traffic"]["provider"]>;

// A provider and channel's price in a region; undefined when the sheet has none.
export function priceIn(
  spec: SpecVersion,
  region: Offer["region"],
  provider: ProviderId,
  channel: ChannelId,
): ProviderPrice | undefined {
  return spec.features.providers?.prices.find(
    (p) =>
      p.provider === provider && p.channel === channel && p.region === region,
  );
}

// One call's price: a message's, or a payment's fee on the problem's average ticket.
const perCall = (
  price: ProviderPrice & { perUnit: number },
  offer: Pick<Offer, "ticketUsd">,
) => price.perUnit + (price.percent ?? 0) * (offer.ticketUsd ?? 0);

// "$40", "$0.30", "$0.0018", "$0.01195": cents from a dime up, else 4 figures.
const usd = (x: number) =>
  Number.isInteger(x)
    ? `$${x.toLocaleString("en-US")}`
    : x >= 0.1
      ? `$${x.toFixed(2)}`
      : `$${String(Number(x.toPrecision(4)))}`;

// What a pick costs, in words: "$0.0018 per SMS", "$0.0012 per message + $5.38 a
// month", "2.9% + $0.30 per payment ($1.46 at $40)"; the spec sheet, with no problem's
// ticket, leaves the bracket out.
export function priceLabel(
  price: ProviderPrice,
  ticketUsd?: number,
): string | null {
  if (price.perUnit === null) return null;
  const monthly =
    (price.monthly === undefined ? "" : ` + ${usd(price.monthly)} a month`) +
    (price.perUser === undefined
      ? ""
      : ` + ${usd(price.perUser)} per monthly user`);
  if (price.percent === undefined)
    return price.perUnit === 0 && monthly !== ""
      ? monthly.slice(3)
      : `${usd(price.perUnit)} per ${price.unit}${monthly}`;
  const percent = `${String(Number((price.percent * 100).toFixed(2)))}%`;
  const fixed = price.perUnit === 0 ? "" : ` + ${usd(price.perUnit)}`;
  const at =
    ticketUsd === undefined
      ? ""
      : ` (${usd(price.perUnit + price.percent * ticketUsd)} at ${usd(ticketUsd)})`;
  return `${percent}${fixed} per ${price.unit}${at}${monthly}`;
}

// The cheapest fee per payment among the processors a card offer's region has.
export function cheapestFee(
  spec: SpecVersion,
  offer: Omit<Offer, "feeTargetUsd">,
): number | null {
  const fees = (spec.features.providers?.prices ?? []).flatMap((p) =>
    p.channel === "card" && p.region === offer.region && p.perUnit !== null
      ? [perCall({ ...p, perUnit: p.perUnit }, offer)]
      : [],
  );
  return fees.length === 0 ? null : Math.min(...fees);
}

// A pick as the player reads it: "MSG91 SMS", and a payment provider, with its one
// channel, by its name alone: "Stripe".
export const pickName = (provider: ProviderId, channel: ChannelId) =>
  channel === "card"
    ? PROVIDER_NAMES[provider]
    : `${PROVIDER_NAMES[provider]} ${CHANNEL_NAMES[channel]}`;

export type Picked =
  | {
      ok: true;
      name: string; // "MSG91 SMS"
      label: string | null; // its price in words, as priceLabel says it
      perCall: number; // USD, a billed call
      monthly: number; // USD a month, with any per-user price on the problem's users
      // A card payment's fee: paid apart from the infrastructure budget, against the
      // problem's fee target (owner, 2026-11-24).
      card: boolean;
      availability: number | null; // the published SLA, if any
    }
  | { ok: false; why: string };

// An external provider's pick in a problem that offers one; null when the problem sets
// its own price (nothing to pick). Not ok: unpicked, a channel the problem doesn't reach
// its users by, or one the provider doesn't offer (or publish) in the problem's region.
export function picked(
  problem: HldProblem,
  spec: SpecVersion,
  node: DesignNode,
): Picked | null {
  const offer = problem.traffic.provider;
  if (offer === undefined || node.kind !== "external_api") return null;
  const { provider, channel } = node.config;
  if (provider === undefined || channel === undefined)
    return {
      ok: false,
      why: `${node.id} has no provider and channel picked, so it does no work.`,
    };
  const name = pickName(provider, channel);
  if (!offer.channels.includes(channel))
    return {
      ok: false,
      why: `${node.id}: this problem doesn't reach its users by ${CHANNEL_NAMES[channel]}, so it does no work.`,
    };
  const price = priceIn(spec, offer.region, provider, channel);
  if (price?.perUnit === null || price === undefined)
    return {
      ok: false,
      why: `${node.id}: ${PROVIDER_NAMES[provider]} doesn't offer ${CHANNEL_NAMES[channel]} at a published price in ${REGION_NAMES[offer.region]}, so it does no work.`,
    };
  return {
    ok: true,
    name,
    label: priceLabel(price, offer.ticketUsd),
    perCall: perCall({ ...price, perUnit: price.perUnit }, offer),
    monthly:
      (price.monthly ?? 0) + (price.perUser ?? 0) * (offer.monthlyUsers ?? 0),
    card: channel === "card",
    availability: price.availability,
  };
}

// A usable pick and its price in words: "MSG91 SMS, $0.0018 per SMS"; null otherwise.
export function pickLabel(
  problem: HldProblem,
  spec: SpecVersion,
  node: DesignNode,
): string | null {
  const p = picked(problem, spec, node);
  if (p?.ok !== true) return null;
  return p.label === null ? p.name : `${p.name}, ${p.label}`;
}

// The canvas's pick on an external provider. A channel stays only while the provider
// offers it in the problem's region, so a stale one never looks picked.
export function pickProvider(
  design: Design,
  problem: HldProblem,
  id: string,
  change: { provider?: ProviderId; channel?: ChannelId },
): Design {
  const node = design.nodes.find((n) => n.id === id);
  const spec = specVersion(design.spec);
  const offer = problem.traffic.provider;
  if (node?.kind !== "external_api" || spec === null || offer === undefined)
    return design;
  const provider = change.provider ?? node.config.provider;
  const channel = change.channel ?? node.config.channel;
  const offered =
    provider !== undefined &&
    channel !== undefined &&
    (priceIn(spec, offer.region, provider, channel)?.perUnit ?? null) !== null;
  const config = {
    ...(provider === undefined ? {} : { provider }),
    ...(channel === undefined || (provider !== undefined && !offered)
      ? {}
      : { channel }),
  };
  return {
    ...design,
    nodes: design.nodes.map((n) => (n.id === id ? { ...node, config } : n)),
  };
}

type ProviderOffer = {
  region: string; // "India"
  seen: string; // the ISO day its prices were read
  providers: { id: ProviderId; name: string; from: string | null }[];
  // The problem's channels at the picked provider; price null: not offered there.
  channels: { id: ChannelId; name: string; price: string | null }[];
};

// What the canvas offers on an external provider: every provider with a price for one
// of the problem's channels anywhere, with its cheapest in the problem's region (null:
// none there), and the channels at `provider` with their prices. Null when the problem
// sets its own price.
export function providerOffer(
  problem: HldProblem,
  provider?: ProviderId,
): ProviderOffer | null {
  const offer = problem.traffic.provider;
  const spec = specVersion(problem.spec);
  const table = spec?.features.providers;
  if (offer === undefined || spec === null || table === undefined) return null;
  const ids = [
    ...new Set(
      table.prices
        .filter((p) => offer.channels.includes(p.channel))
        .map((p) => p.provider),
    ),
  ];
  const label = (id: ProviderId, channel: ChannelId) => {
    const price = priceIn(spec, offer.region, id, channel);
    return price === undefined ? null : priceLabel(price, offer.ticketUsd);
  };
  return {
    region: REGION_NAMES[offer.region],
    seen: table.seen,
    providers: ids.map((id) => {
      const offered = offer.channels.flatMap((c) => {
        const price = priceIn(spec, offer.region, id, c);
        const text =
          price === undefined ? null : priceLabel(price, offer.ticketUsd);
        return price?.perUnit === null || price === undefined || text === null
          ? []
          : [
              {
                cost: perCall({ ...price, perUnit: price.perUnit }, offer),
                text,
              },
            ];
      });
      const cheapest = offered.sort((a, b) => a.cost - b.cost)[0];
      return {
        id,
        name: PROVIDER_NAMES[id],
        from:
          cheapest === undefined
            ? null
            : offered.length === 1
              ? cheapest.text
              : `from ${cheapest.text}`,
      };
    }),
    channels: offer.channels.map((c) => ({
      id: c,
      name: CHANNEL_NAMES[c],
      price: provider === undefined ? null : label(provider, c),
    })),
  };
}
