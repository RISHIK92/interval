const MAX_AMOUNT = 10 ** 12;
const MAX_UNIT = 10 ** 9;
const MAX_QTY = 1000;

// How one locale writes an amount. Every line asks this one place, so the same amount
// reads the same wherever it's shown.
class Locale {
  private readonly sign: string;
  private readonly signFirst: boolean;
  private readonly grouping: string;
  private readonly decimal: string;

  constructor(
    sign: string,
    signFirst: boolean,
    grouping: string,
    decimal: string,
  ) {
    this.sign = sign;
    this.signFirst = signFirst;
    this.grouping = grouping;
    this.decimal = decimal;
  }

  price(amount: number): string {
    let whole = amount;
    let tail = "";
    if (this.decimal !== "") {
      whole = Math.floor(amount / 100);
      tail = this.decimal + String(amount % 100).padStart(2, "0");
    }
    const digits = String(whole);
    const groups: string[] = [];
    for (let end = digits.length; end > 0; end -= 3)
      groups.unshift(digits.slice(Math.max(0, end - 3), end));
    const number = groups.join(this.grouping) + tail;
    return this.signFirst ? this.sign + number : `${number} ${this.sign}`;
  }
}

function checked(amount: number, most: number): number {
  if (!(amount >= 0 && amount <= most))
    throw new RangeError("amount out of range");
  return amount;
}

export class PriceFormatter {
  private readonly locales = new Map<string, Locale>([
    ["en-US", new Locale("$", true, ",", ".")],
    ["de-DE", new Locale("EUR", false, ".", ",")],
    ["ja-JP", new Locale("JPY", false, ",", "")],
  ]);

  private locale(locale: string): Locale {
    const found = this.locales.get(locale);
    if (found === undefined) throw new RangeError("unknown locale");
    return found;
  }

  checkoutLine(cents: number, locale: string): string {
    return "Total: " + this.locale(locale).price(checked(cents, MAX_AMOUNT));
  }

  receiptLine(
    item: string,
    cents: number,
    qty: number,
    locale: string,
  ): string {
    if (item === "") throw new RangeError("an item has a name");
    if (!(qty >= 1 && qty <= MAX_QTY))
      throw new RangeError("qty must be within 1 and 1000");
    const found = this.locale(locale);
    const unit = checked(cents, MAX_UNIT);
    return `${item} ${String(qty)} x ${found.price(unit)} = ${found.price(unit * qty)}`;
  }

  emailSummary(totalCents: number, locale: string): string {
    return `Your order comes to ${this.locale(locale).price(checked(totalCents, MAX_AMOUNT))}.`;
  }

  // The extension round: a locale is data, so a new one changes no line's code.
  addLocale(
    locale: string,
    currencySign: string,
    signFirst: boolean,
    grouping: string,
    decimal: string,
  ): void {
    if (locale === "" || this.locales.has(locale))
      throw new RangeError("a locale needs a new, non-empty name");
    if (currencySign === "") throw new RangeError("a currency has a sign");
    this.locales.set(
      locale,
      new Locale(currencySign, signFirst, grouping, decimal),
    );
  }
}
