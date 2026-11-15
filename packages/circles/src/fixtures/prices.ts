/** Real responses recorded 2026-11-14 ~21:00 Nairobi. Public market data, no personal data. */

export const coingeckoResponse = {
  bitcoin: {
    eur: 59650.470857806424,
    kes: 8551555.679940172,
    last_updated_at: 1794678950,
  },
};

/** Trimmed to the fields Rota reads; the real response lists 664 rates. */
export const coinbaseResponse = {
  data: {
    currency: "BTC",
    rates: { EUR: "59638.26", KES: "8550488.385", XOF: "39126962.29717305" },
  },
};

/** CoinGecko's own XOF in the same response, to check the peg. */
export const coingeckoXof = 39128143.942064285;
