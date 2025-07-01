import * as dotenv from 'dotenv';
dotenv.config();

import '../../src/lib/log4js';
import Database from '../../src/database';
import StakesTracker from './staking/stakes-tracker';
import { validateTransactions } from './transactions-validation/validateTransactions';
import { fetchRefundableTransactionsAllChains } from './transactions-indexing/fetchRefundableTransactionsAllChains';
import { trackRootUpdate } from '../../src/lib/track-root-update';

const logger = global.LOGGER('GRP_V3');

async function startComputingGasRefundAllChains_V3() {
  await Database.connectAndSync('gas-refund-computation_V3');
  

  return Database.sequelize.transaction(async () => {
    // TODO: disable this piece in previous cronjob, uncomment it in this one
    // await trackRootUpdate();

    await StakesTracker.getInstance().loadHistoricalStakes();

    await fetchRefundableTransactionsAllChains();

    await validateTransactions();
  });
}

startComputingGasRefundAllChains_V3()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    logger.error(
      'startComputingGasRefundAllChains_V3 exited with error:',
      err,
      err.response?.data,
      err.request?.path,
    );
    process.exit(1);
  });
