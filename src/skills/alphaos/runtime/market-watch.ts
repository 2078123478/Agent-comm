import type { Quote } from "../types";
import { OnchainOsClient } from "./onchainos-client";
import { StateStore } from "./state-store";

export class MarketWatch {
  constructor(
    private readonly client: OnchainOsClient,
    private readonly store: StateStore,
  ) {}

  async fetch(pair: string, dexes: string[]): Promise<Quote[]> {
    const quotes = await this.client.getQuotes(pair, dexes);
    for (const q of quotes) {
      this.store.insertMarketSnapshot(q);
    }
    return quotes;
  }
}
