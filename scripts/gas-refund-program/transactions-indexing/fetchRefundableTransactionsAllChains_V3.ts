import { assert } from 'ts-essentials';
import {
  getCurrentEpoch,
  resolveEpochCalcTimeInterval,
} from '../../../src/lib/gas-refund/epoch-helpers';

import {
  CHAIN_ID_MAINNET,  
} from '../../../src/lib/constants';
import { fetchPricingAndTransactions_V3 } from './fetchPricingAndTransactions_V3';

const logger = global.LOGGER('GRP::fetchRefundableTransactionsAllChains_V3');

export async function fetchRefundableTransactionsAllChains_V3() {
  const chainId = CHAIN_ID_MAINNET; // For now, only mainnet txs are refunded
  const epoch = getCurrentEpoch();
  logger.info(`Fetching refundable transactions for epoch ${epoch} on chain ${chainId}`);
  
  const { startCalcTime, endCalcTime } = await resolveEpochCalcTimeInterval(
    epoch,
  );

  assert(startCalcTime, `could not resolve ${epoch}th epoch start time`);
  assert(endCalcTime, `could not resolve ${epoch}th epoch end time`);

  await fetchPricingAndTransactions_V3({
    chainId,
    epoch,
    startTimestamp: startCalcTime,
    endTimestamp: endCalcTime,
  });
}
