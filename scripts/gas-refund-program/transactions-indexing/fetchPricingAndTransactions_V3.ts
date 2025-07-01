import {
  constructPriceResolver,
  fetchDailyPSPChainCurrencyRate,
} from '../token-pricing/psp-chaincurrency-pricing';
import { fetchRefundableTransactions_V3 } from './fetchRefundableTransactions_V3';

const logger = global.LOGGER('GRP:fetchPricingAndTransactions_V3');

export async function fetchPricingAndTransactions_V3({
  chainId,
  startTimestamp,
  endTimestamp,
  epoch,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epoch: number;
}) {
  // retrieve daily psp/native currency rate for (startCalcTime, endCalcTime)
  logger.info(
    `start fetching daily vlr/native currency rate for chainId=${chainId}`,
  );
  // TODO: move to VLR
  const pspNativeCurrencyDailyRate = await fetchDailyPSPChainCurrencyRate({
    chainId,
    startTimestamp: startTimestamp - 48 * 60 * 60, // overfetch to allow for last 24h avg
    endTimestamp,
  });

  const resolvePrice = constructPriceResolver(
    pspNativeCurrencyDailyRate,
    'last24h', // for backward compatibility
  );

  // retrieve all tx beetween (start_epoch_timestamp, end_epoch_timestamp) +  compute progressively mapping(chainId => address => mapping(timestamp => accGasUsedPSP)) // address: txOrigin, timestamp: start of the day
  logger.info(
    `start indexing transaction and accumulate tx fees and refund for chainId=${chainId}`,
  );

  await fetchRefundableTransactions_V3({
    chainId,
    startTimestamp,
    endTimestamp,
    epoch,
    resolvePrice,
  });
}
