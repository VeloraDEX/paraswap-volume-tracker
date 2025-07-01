import {
  CHAIN_ID_BASE,
  CHAIN_ID_MAINNET,
  CHAIN_ID_OPTIMISM,
} from '../constants';
import { GRP2ConfigByChain } from './config';

// epoch 56 from/to: 1734955200	1737374400	12/23/2024 12:00:00	1/20/2025 12:00:00
// epoch 57 from/to: 1737374400	1739793600	1/20/2025 12:00:00	2/17/2025 12:00:00

// TODO: set correct epoch when time comes, for now setting it to 56 to test previous distribution as if it happened on v3 staking
export const STAKING_V3_TIMESTAMP = 1734955200;

type GRPV3GlobalConfig = {
  startEpochTimestamp: number;
  epochDuration: number;
  seXYZPowerMultiplier: number;
};

export const grp3GlobalConfig: GRPV3GlobalConfig = {
  startEpochTimestamp: STAKING_V3_TIMESTAMP,
  epochDuration: 4 * 7 * 24 * 60 * 60,
  seXYZPowerMultiplier: 2.5,
};

export const grpConfigParticularities_V3: {
  [network: number]: GRP2ConfigByChain;
} = {
  // @TODO: adjust here
  [CHAIN_ID_MAINNET]: {
    stakingStartCalcTimestamp:
      Math.round(new Date('May-14-2025 06:47:47 AM UTC').getTime() / 1000) + 5, // tx that deploys seVLR https://etherscan.io/tx/0xc6f5077dc180b570211fd3e381bbe2b568466bfd46aa3f0c68310d8e2bfd7efc
  },
  [CHAIN_ID_BASE]: {
    stakingStartCalcTimestamp:
      Math.round(new Date('May-14-2025 07:01:57 AM UTC').getTime() / 1000) + 5, // tx that deploys seVLR https://basescan.org/tx/0x4321c740351edb99a794df750ce4eaca04f798fdc20ff5ea82d63cb98e838744
  },
  [CHAIN_ID_OPTIMISM]: {
    stakingStartCalcTimestamp:
      Math.round(new Date('May-14-2025 07:04:53 AM UTC').getTime() / 1000) + 5, // tx that deploys seVLR https://optimistic.etherscan.io/tx/0xfc19542ceccbdf6e0f1e7e62930f834600f7941b4204aaec52b0c38dc37bbe02
  },
};

console.log(grpConfigParticularities_V3);

type GRPV2ConfigByChain_V3 = {
  seXYZ: string;
  bpt: string;
  // psp1ToPsp2Migrator?: string;  // unlike with v1->v2, we don't refund migration v2->v3 txs
};

export const grp2ConfigByChain_V3: {
  [chainId: number]: GRPV2ConfigByChain_V3;
} = {
  [CHAIN_ID_MAINNET]: {
    seXYZ: l('0x53fE8d8C00F9FBF55C4276b9cf8451f586D21055'),
    bpt: l('0x01b3F3aabFf34e266A98e771438320DF98d447dD'),
  },
  [CHAIN_ID_OPTIMISM]: {
    seXYZ: l('0xCbed2888F7F969841a2df28DDA972D40264FCcda'),
    bpt: l('0x4291b31b17511A26E4131da396145Ef6A5f83875'),
  },
  [CHAIN_ID_BASE]: {
    seXYZ: l('0xa85A6Ccff277a69B80FCd33Bec7DE066147ABF75'),
    bpt: l('0xEe1e5301dc293E1468fAc27B9b53F309f0AE8344'),
  },
};

export const STAKING_CHAIN_IDS_V3 =
  Object.keys(grp2ConfigByChain_V3).map(Number);
