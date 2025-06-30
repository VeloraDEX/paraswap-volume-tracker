import '../../src/lib/log4js';
import * as dotenv from 'dotenv';
dotenv.config();

import { CHAIN_ID_MAINNET } from '../../src/lib/constants';
import { StakeV3Resolver } from '../../scripts/gas-refund-program/staking/2.0/StakeV3Resolver';
import { GRP2EpochResolver } from '../../src/lib/gas-refund/epoch-helpers';

import { BPTHelper_V3 } from '../../scripts/gas-refund-program/staking/2.0/BPTHelper_V3';
import { BlockInfo } from '../../src/lib/block-info';

jest.setTimeout(5 * 60 * 1000);

describe('V3 bpt state', () => {
  describe('assert computed bptState corresponds to on-chain one', () => {
    test(`check computed state after few actions on chain (swap / addLiquidity / removeLiquidity)`, async () => {
      const EPOCH = 62;
      const CHAIN_ID = CHAIN_ID_MAINNET;
      // const timestamp = new Date('2025-06-30 10:31:18 UTC').getTime() / 1000; // still epoch 62...
      // const timestamp = new Date('Jun-10-2025 07:38:35 AM UTC').getTime() / 1000; // still epoch 62. Only one swap happened by now
      // const timestamp = new Date('Jun-22-2025 10:06:11 AM UTC').getTime() / 1000; // still epoch 62. Only one swap + one addLiquidity happened by now
      // const timestamp = new Date('Jun-30-2025 07:35:59 AM UTC').getTime() / 1000; // still epoch 62. Only one swap + one addLiquidity + one more swap
      const timestamp =
        new Date('Jun-30-2025 01:01:23 PM UTC').getTime() / 1000; // still epoch 62. Only one swap + one addLiquidity + 2 more swap

      const {
        startCalcTime: epochStartTime,
        // , endCalcTime: epochEndtime
      } = await GRP2EpochResolver.resolveEpochCalcTimeInterval(EPOCH);

      const stakeV3Instance = StakeV3Resolver.getInstance(CHAIN_ID);
      await stakeV3Instance.loadWithinInterval(epochStartTime, timestamp);

      // const bptInitialState = stakeV3Instance.bptTracker.initState;
      // const bptDifferentialStates =
      //   stakeV3Instance.bptTracker.differentialStates;

      const bptCopmutedState =
        stakeV3Instance.bptTracker.getBPTState(timestamp);

      const block = await BlockInfo.getInstance(
        CHAIN_ID,
      ).getBlockAfterTimeStamp(timestamp);

      if (!block) throw new Error(`Block not found for timestamp ${timestamp}`);

      const bptOnChainState = await BPTHelper_V3.getInstance(
        CHAIN_ID,
      ).fetchBPtState(block);

      const diff = {
        totalSupply: bptCopmutedState.totalSupply
          .minus(bptOnChainState.bptTotalSupply)
          .toFixed(),
        ethBalance: bptCopmutedState.ethBalance
          .minus(bptOnChainState.ethBalance)
          .toFixed(),
        xyzBalance: bptCopmutedState.xyzBalance
          .minus(bptOnChainState.xyzBalance)
          .toFixed(),
      };

      // diffs must be zero
      expect(diff.totalSupply === '0').toBeTruthy();
      expect(diff.ethBalance === '0').toBeTruthy();
      expect(diff.xyzBalance === '0').toBeTruthy();
    });
  });
});
