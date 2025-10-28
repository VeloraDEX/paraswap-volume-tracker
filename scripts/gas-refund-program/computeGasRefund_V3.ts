import * as dotenv from 'dotenv';
dotenv.config();

import '../../src/lib/log4js';
import Database from '../../src/database';
import StakesTracker_V3 from './staking/stakes-tracker_V3';
import { fetchRefundableTransactionsAllChains_V3 } from './transactions-indexing/fetchRefundableTransactionsAllChains_V3';
import { validateTransactions_V3 } from './transactions-validation/validateTransactions_V3';
import { trackRootUpdate_V3 } from '../../src/lib/track-root-update-V3';

const logger = global.LOGGER('GRP_V3');

async function startComputingGasRefundAllChains_V3() {
  await Database.connectAndSync('gas-refund-computation_V3');

  return Database.sequelize.transaction(async () => {
    // TODO: disable this piece in previous cronjob after migrating to new one
    await trackRootUpdate_V3();

    await StakesTracker_V3.getInstance().loadHistoricalStakes();

    await fetchRefundableTransactionsAllChains_V3();

    // // if exceeds budget 500 USD per user - cap it
    await validateTransactions_V3();
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
