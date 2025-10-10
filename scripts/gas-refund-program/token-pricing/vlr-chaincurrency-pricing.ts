import * as pMemoize from 'p-memoize';
import * as QuickLRU from 'quick-lru';
import {
  CHAIN_TO_COIN_ID,
  CoingeckoPriceHistory,
  computeDailyAvgLast24h,
  fetchHistoricalPriceCoingecko,
  sampleDailyAvgPricesStartOfDay,
  VLR_COINGECKO_COIN_ID,
} from './coingecko';
import { startOfDayMilliSec } from '../../../src/lib/utils/helpers';

const fetchHistoricalPriceCoingeckoCached = pMemoize(
  fetchHistoricalPriceCoingecko,
  {
    cacheKey: args => JSON.stringify(args[0]),
    cache: new QuickLRU({
      maxSize: 100,
    }),
  },
);

type PricesAtTimestamp = {
  vlrToChainCurRate: number;
  chainPrice: number;
  vlrPrice: number;
};
type PricesByTimestamp = {
  [timestamp: string]: PricesAtTimestamp;
};

type HistoricalTokenUsdPrices = {
  chainCurrencyHistoricalPrices: CoingeckoPriceHistory;
  vlrHistoricalPrices: CoingeckoPriceHistory;
};

export async function fetchDailyVlrChainCurrencyRate({
  chainId,
  startTimestamp,
  endTimestamp,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
}): Promise<HistoricalTokenUsdPrices> {
  const [chainCurrencyHistoricalPrices, vlrHistoricalPrices] =
    await Promise.all([
      fetchHistoricalPriceCoingeckoCached({
        startTimestamp,
        endTimestamp,
        coinId: CHAIN_TO_COIN_ID[chainId],
      }),
      fetchHistoricalPriceCoingeckoCached({
        startTimestamp,
        endTimestamp,
        coinId: VLR_COINGECKO_COIN_ID,
      }),
    ]);

  return { chainCurrencyHistoricalPrices, vlrHistoricalPrices };
}

export type PriceResolverFn_V3 = (unixtime: number) => PricesAtTimestamp;

// Deprecated algo but still used for older epoch (<11)
const constructSameDayPriceResolver = (
  prices: HistoricalTokenUsdPrices,
): PriceResolverFn_V3 => {
  const dailyAvgChainCurPrice = sampleDailyAvgPricesStartOfDay(
    prices.chainCurrencyHistoricalPrices,
  );
  const dailyAvgVlrPrice = sampleDailyAvgPricesStartOfDay(
    prices.vlrHistoricalPrices,
  );

  const aggregatedPrices = Object.keys(
    dailyAvgChainCurPrice,
  ).reduce<PricesByTimestamp>((acc, timestamp) => {
    const vlrPrice = dailyAvgVlrPrice[timestamp];
    const chainPrice = dailyAvgChainCurPrice[timestamp];
    const vlrToChainCurRate = vlrPrice / chainPrice;

    acc[timestamp] = { vlrToChainCurRate, chainPrice, vlrPrice };

    return acc;
  }, {});

  return function findSameDayPrice(unixtime: number) {
    const startOfDayTimestamp = startOfDayMilliSec(unixtime * 1000);
    return aggregatedPrices[startOfDayTimestamp];
  };
};

// computes moving average prices for last 24h
const constructLast24hAvgPriceResolver = (
  prices: HistoricalTokenUsdPrices,
): PriceResolverFn_V3 => {
  return function resolveLast24hAvgPrice(unixTime: number) {
    const avgChainCurrencyPrice = computeDailyAvgLast24h(
      prices.chainCurrencyHistoricalPrices,
      unixTime * 1000,
    );
    const avgVlrPrice = computeDailyAvgLast24h(
      prices.vlrHistoricalPrices,
      unixTime * 1000,
    );

    return {
      vlrToChainCurRate: avgVlrPrice / avgChainCurrencyPrice,
      chainPrice: avgChainCurrencyPrice,
      vlrPrice: avgVlrPrice,
    };
  };
};

export const constructPriceResolver_V3 = (
  prices: HistoricalTokenUsdPrices,
  mode: 'sameDay' | 'last24h',
): PriceResolverFn_V3 => {
  return mode === 'sameDay'
    ? constructSameDayPriceResolver(prices)
    : constructLast24hAvgPriceResolver(prices);
};
