function resultValue(value) {
  return value &&
    (typeof value === "object" || typeof value === "function") &&
    "result" in value
    ? value.result
    : value;
}

export function contractResultValue(value) {
  const result = resultValue(value);
  if (
    result &&
    typeof result === "object" &&
    "error" in result
  ) {
    throw new Error(`contract read failed: ${String(result.error)}`);
  }
  return result &&
    typeof result === "object" &&
    "value" in result
    ? result.value
    : result;
}

function phaseName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.tag === "string") return value.tag;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function epochValue(value) {
  const epoch = resultValue(value);
  return epoch
    ? { ...epoch, phase: phaseName(epoch.phase) }
    : null;
}

const MARKET_CHANGE_FIELDS = [
  "status",
  "epoch",
  "accepted",
  "yesCount",
  "noCount",
];

export function marketCatalogChanged(previous, current) {
  return !previous ||
    MARKET_CHANGE_FIELDS.some((key) => previous[key] !== current[key]);
}

export class PrivateMarketCatalog {
  constructor({
    registry,
    vault,
    marketClient,
    readConcurrency = 2,
    now = () => Date.now(),
  }) {
    if (
      !registry ||
      !vault ||
      !marketClient ||
      !Number.isSafeInteger(readConcurrency) ||
      readConcurrency < 1
    ) {
      throw new Error("private market catalog configuration is incomplete");
    }
    this.registry = registry;
    this.vault = vault;
    this.marketClient = marketClient;
    this.readConcurrency = readConcurrency;
    this.now = now;
    this.current = {
      checkedAt: null,
      markets: [],
      errors: [],
    };
    this.inFlight = null;
    this.invalidated = false;
  }

  snapshot() {
    return this.current;
  }

  isStale(maximumAgeMs) {
    if (this.invalidated) return true;
    const checkedAt = Date.parse(this.current.checkedAt || "");
    return !Number.isFinite(checkedAt) || this.now() - checkedAt > maximumAgeMs;
  }

  invalidate() {
    this.invalidated = true;
  }

  refresh() {
    if (this.inFlight) {
      return this.inFlight.then(() =>
        this.invalidated ? this.refresh() : this.current
      );
    }
    this.invalidated = false;
    const refresh = this.refreshUnlocked();
    const tracked = refresh.finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });
    this.inFlight = tracked;
    return tracked.then(() =>
      this.invalidated ? this.refresh() : this.current
    );
  }

  async refreshUnlocked() {
    const prior = new Map(
      this.current.markets.map((entry) => [entry.market, entry]),
    );
    const markets = this.registry.list();
    const reads = new Array(markets.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < markets.length) {
        const index = cursor++;
        try {
          reads[index] = {
            status: "fulfilled",
            value: await this.readMarket(markets[index]),
          };
        } catch (reason) {
          reads[index] = { status: "rejected", reason };
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.readConcurrency, markets.length) },
        worker,
      ),
    );
    const next = [];
    const errors = [];
    for (let index = 0; index < markets.length; index++) {
      const market = markets[index];
      const result = reads[index];
      if (result.status === "fulfilled") {
        next.push(result.value);
        continue;
      }
      const cached = prior.get(market);
      if (cached) next.push(cached);
      errors.push({
        market,
        error: String(result.reason?.message || result.reason),
      });
    }
    this.current = {
      checkedAt: new Date(this.now()).toISOString(),
      markets: next,
      errors,
    };
    return this.current;
  }

  async readMarket(market) {
    const [client, registrationResult] = await Promise.all([
      this.marketClient(market),
      this.vault.registration({ market }),
    ]);
    const registration = resultValue(registrationResult);
    if (!registration || registration.market !== market) {
      throw new Error("private market registration is unavailable");
    }
    const epochNumber = BigInt(registration.current_epoch);
    const scenarioRead = client.scenario_state()
      .then(contractResultValue)
      .catch((error) => {
        if (registration.finalized) return { market_assets: 0n };
        throw error;
      });
    const [state, priceYes, outcome, info, scenario, epochResult] =
      await Promise.all([
        client.get_state(),
        client.price_yes(),
        client.outcome(),
        client.market_info(),
        scenarioRead,
        this.vault.epoch({ market, epoch_number: epochNumber }),
      ]);
    const epoch = epochValue(epochResult);
    const previousEpoch = epoch &&
      BigInt(epoch.last_sequence || 0) === 0n &&
      epochNumber > 0n
      ? epochValue(await this.vault.epoch({
          market,
          epoch_number: epochNumber - 1n,
        }))
      : null;
    return {
      market,
      checkedAt: new Date(this.now()).toISOString(),
      state: contractResultValue(state),
      priceYes: contractResultValue(priceYes),
      outcome: resultValue(outcome) ?? null,
      info: contractResultValue(info),
      scenario,
      registration,
      epoch,
      previousEpoch,
    };
  }
}
