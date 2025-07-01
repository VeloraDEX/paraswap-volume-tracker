import { assert } from 'ts-essentials';
import {
  OFFSET_CALC_TIME,
  SCRIPT_START_TIME_SEC,
} from '../../../src/lib/gas-refund/common';
import {
  forceStakingChainId,
  grp2CConfigParticularities,
  STAKING_V3_TIMESTAMP,
} from '../../../src/lib/gas-refund/config';
import {
  CHAIN_ID_BASE,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
} from '../../../src/lib/constants';
import {
  getCurrentEpoch,
  getEpochStartCalcTime,
} from '../../../src/lib/gas-refund/epoch-helpers';
import {
  GasRefundGenesisEpoch,
  GasRefundSafetyModuleAllPSPInBptFixStartEpoch,
  GasRefundSafetyModuleStartEpoch,
  GasRefundSPSPStakesAlgoFlipEpoch,
  GasRefundV2EpochFlip,
  GasRefundV3EpochFlip,
  GasRefundVirtualLockupStartEpoch,
} from '../../../src/lib/gas-refund/gas-refund';
import { loadEpochToStartFromWithFix } from './2.0/fix';
import { StakeV2Resolver } from './2.0/StakeV2Resolver';
import SafetyModuleStakesTracker from './safety-module-stakes-tracker';
import SPSPStakesTracker from './spsp-stakes-tracker';
import BigNumber from 'bignumber.js';
import { StakeV3Resolver } from './2.0/StakeV3Resolver';
import { GasRefundTransactionStakeSnapshotData_V3 } from '../../../src/models/GasRefundTransactionStakeSnapshot_V3';
import { getLatestEpochRefunded } from '../persistance/db-persistance';

const logger = global.LOGGER('StakesTracker_V3');

export type StakedScoreV3 = {
  combined: BigNumber;
  version: 3;
  byNetwork: Record<
    number,
    | Pick<
        GasRefundTransactionStakeSnapshotData_V3,
        'bptXYZBalance' | 'bptTotalSupply' | 'seXYZBalance' | 'stakeScore'
      >
    | undefined
  >;
};

export default class StakesTracker_V3 {
  chainIds_V3 = [CHAIN_ID_MAINNET, CHAIN_ID_OPTIMISM, CHAIN_ID_BASE];

  static instance: StakesTracker_V3;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StakesTracker_V3();
    }
    return this.instance;
  }

  async loadHistoricalStakes(forcedEpoch?: number) {
    const epoch = forcedEpoch || getCurrentEpoch();

    logger.info('v3 loadHistoricalStakes::epoch', epoch);

    const endTime = SCRIPT_START_TIME_SEC - OFFSET_CALC_TIME;

    const startTimeStakeV3 = await getEpochStartCalcTime(epoch);

    await Promise.all(
      this.chainIds_V3.map(async chainId =>
        StakeV3Resolver.getInstance(chainId).loadWithinInterval(
          startTimeStakeV3,
          endTime,
        ),
      ),
    );
  }

  computeStakeScore(
    _account: string,
    timestamp: number,    
  ): StakedScoreV3 {
    const account = _account.toLowerCase();
    const byNetwork: StakedScoreV3['byNetwork'] = this.chainIds_V3.reduce(
      (acc, chainId) => {
        if (timestamp < STAKING_V3_TIMESTAMP) {
          return acc;
        }

        return {
          ...acc,
          [chainId]: StakeV3Resolver.getInstance(chainId).getStakeForRefund(
            timestamp,
            account,
          ),
        };
      },
      {},
    );

    return {
      version: 3,
      combined: Object.values(byNetwork).reduce<BigNumber>(
        (acc, val) => acc.plus(val?.stakeScore || 0),
        new BigNumber(0),
      ),
      byNetwork,
    };
  }
}
